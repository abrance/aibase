/**
 * SSE EventSource wrapper — mirrors P4OC's OpenCodeEventSource.
 *
 * Adds on top of the raw @opencode-ai/sdk event.subscribe() stream:
 *   - Generation-based stale event protection
 *   - Consecutive error tracking + escalation
 *   - Duplicate-error-counting guard (onError→onClosed sequence)
 *   - Exponential-backoff reconnect with jitter
 *   - Connection state transitions (Connecting → Connected → Error → …)
 *
 * Lifecycle:
 *   connect()  → starts SSE and begins emitting events
 *   disconnect() → clean shutdown, state → Disconnected
 *   shutdown()  → permanent stop (no further connects accepted)
 *
 * Events are exposed as a Node.js EventEmitter:
 *   - "event"     (scopedEvent)  — parsed SSE event
 *   - "state"     (state)         — connection state changed
 *   - "escalated" ()             — max consecutive errors reached → Disconnected
 *
 *   - "event"     (scopedEvent)  — parsed SSE event  
 *   - "state"     (state)         — connection state changed
 *   - "escalated" ()             — max consecutive errors reached → Disconnected
 */

import { ConnectionState, directoryKey, DEFAULT_MAX_CONSECUTIVE_ERRORS, DEFAULT_RETRY_DELAY_MS, DEFAULT_MAX_RETRY_DELAY_MS, DEFAULT_HEALTH_PROBE_TIMEOUT_MS } from "./connection-state.mjs";

export class EventSourceManager {
  /** @type {import("./connection-state.mjs").EventSourceConfig} */
  #config;

  /** @type {import("@opencode-ai/sdk").Opencode} */
  #client;

  /** @type {number} */
  #generation = 0;

  /** @type {boolean} */
  #isShutdown = false;

  /** @type {number} */
  #consecutiveErrors = 0;

  /** @type {{ stream: AsyncIterable<any>, controller: AbortController } | null} */
  #activeStream = null;

  /** @type {string} */
  #state;

  /** @type {boolean} */
  #errorFiredSinceOpen = false;

  /** @type {number | null} */
  #reconnectTimer = null;

  /** @type {Array<(scopedEvent: import("./connection-state.mjs").ScopedEvent<any>) => void>} */
  #eventListeners = [];

  /** @type {Array<(state: string) => void>} */
  #stateListeners = [];

  /** @type {Array<() => void>} */
  #escalatedListeners = [];

  /**
   * @param {import("./connection-state.mjs").EventSourceConfig} config
   * @param {import("@opencode-ai/sdk").Opencode} client
   */
  constructor(config, client) {
    this.#config = config;
    this.#client = client;
    this.#state = ConnectionState.Disconnected;
  }

  // ─── Public API ──────────────────────────────────────────

  /** Current connection state. */
  get state() {
    return this.#state;
  }

  /** Current generation number (monotonically increasing). */
  get generation() {
    return this.#generation;
  }

  /** Number of consecutive errors since last successful connect. */
  get consecutiveErrors() {
    return this.#consecutiveErrors;
  }

  /**
   * Start the SSE event stream.
   * No-op if already connected/connecting or shut down.
   */
  connect() {
    if (this.#isShutdown) {
      console.warn("[EventSource] connect() called after shutdown — ignoring");
      return;
    }
    if (this.#activeStream) {
      console.debug("[EventSource] connect() called but already active — no-op");
      return;
    }

    console.debug("[EventSource] connect() — starting SSE stream");
    this.#setState(ConnectionState.Connecting);
    this.#consecutiveErrors = 0;
    this.#generation++;

    this.#run(this.#generation);
  }

  /**
   * Clean disconnect — abort current stream, state → Disconnected.
   */
  disconnect() {
    console.debug("[EventSource] disconnect() called");
    this.#abortStream();
    this.#clearReconnectTimer();
    this.#setState(ConnectionState.Disconnected);
  }

  /**
   * Permanent shutdown — after this, connect() is a no-op.
   */
  shutdown() {
    console.debug("[EventSource] shutdown() called");
    this.#isShutdown = true;
    this.disconnect();
    this.#eventListeners.length = 0;
    this.#stateListeners.length = 0;
    this.#escalatedListeners.length = 0;
  }

  /**
   * Reset error counter — useful on foreground resume before reconnect.
   */
  resetConsecutiveErrors() {
    this.#consecutiveErrors = 0;
  }

  // ─── Event listeners ─────────────────────────────────────

  /** @param {(event: import("./connection-state.mjs").ScopedEvent<any>) => void} fn */
  onEvent(fn) { this.#eventListeners.push(fn); }

  /** @param {(state: string) => void} fn */
  onState(fn) { this.#stateListeners.push(fn); }

  /** @param {() => void} fn */
  onEscalated(fn) { this.#escalatedListeners.push(fn); }

  // ─── Health probe ─────────────────────────────────────────

  /**
   * Quick server reachability check before opening SSE.
   * Uses a fast fetch (not the SDK, to avoid heavy setup) with a configurable
   * timeout. Returns the URL that passed the probe, or null if unreachable.
   *
   * Inspired by P4OC's ConnectionManager probe: listProjects() → then SSE.
   *
   * @returns {Promise<string | null>} the base URL that passed, or null
   */
  async #healthProbe() {
    const url = this.#config.baseUrl.replace(/\/$/, "");
    const probeUrl = `${url}/api/health`;
    const timeout = this.#config.healthProbeTimeoutMs ?? DEFAULT_HEALTH_PROBE_TIMEOUT_MS;

    console.debug(`[EventSource] health probe → ${probeUrl} (timeout=${timeout}ms)`);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const headers = {};
      if (this.#config.username && this.#config.password) {
        headers.authorization =
          "Basic " + Buffer.from(`${this.#config.username}:${this.#config.password}`).toString("base64");
      }

      const response = await fetch(probeUrl, {
        signal: controller.signal,
        method: "HEAD",
        headers,
      });

      clearTimeout(timer);

      if (response.ok) {
        console.debug(`[EventSource] health probe passed (HTTP ${response.status})`);
        return url;
      }

      console.warn(`[EventSource] health probe failed: HTTP ${response.status} — will try SSE anyway`);
      return url; // Non-2xx: server is reachable, SSE might work; don't block
    } catch (error) {
      if (error?.name === "AbortError") {
        console.warn(`[EventSource] health probe timed out after ${timeout}ms — will try SSE anyway`);
      } else {
        console.warn(`[EventSource] health probe error: ${error?.message || error} — will try SSE anyway`);
      }
      return url; // Probe failure is non-blocking: server may not expose /api/health
    }
  }

  // ─── Internal ─────────────────────────────────────────────

  /**
   * Run SSE stream for a specific generation.
   * On stream end/error, decides between retry (reconnect) or escalate.
   */
  async #run(gen) {
    if (this.#isShutdown || gen !== this.#generation) return;

    const controller = new AbortController();
    this.#activeStream = { stream: null, controller };
    this.#errorFiredSinceOpen = false;

    try {
      // Health probe: quick reachability check before opening SSE.
      // Non-blocking on failure — SSE is attempted regardless.
      await this.#healthProbe();

      // Stale check after probe (may have been disconnected during await)
      if (gen !== this.#generation || this.#isShutdown) return;

      const result = await this.#client.event.subscribe({
        query: { directory: this.#config.directory },
        signal: controller.signal,
      });

      // Stale check — abort if generation changed while subscribe was in-flight
      if (gen !== this.#generation) {
        controller.abort();
        return;
      }

      this.#activeStream = { stream: result.stream, controller };
      this.#errorFiredSinceOpen = false;
      this.#consecutiveErrors = 0;
      this.#setState(ConnectionState.Connected);

      // Emit a synthetic "connected" event for consumers that need it
      this.#emitEvent({
        type: "connection.connected",
        generation: gen,
        timestamp: Date.now(),
      });

      for await (const event of result.stream) {
        if (gen !== this.#generation) break; // stale generation — discard

        this.#emitEvent({
          ...event,
          _generation: gen,
          _timestamp: Date.now(),
        });
      }

      // Stream ended cleanly (server-side close without error)
      if (gen === this.#generation && !this.#isShutdown) {
        this.#handleCleanClose(gen);
      }
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) {
        // Intentional abort (disconnect/shutdown/stale) — don't count
        return;
      }
      if (gen !== this.#generation) return; // stale

      this.#handleError(gen, error);
    }
  }

  /**
   * Clean close without preceding error (e.g. server shutdown).
   * Follows P4OC pattern: count it (could indicate persistent issue),
   * but don't double-count if onError already fired this cycle.
   */
  #handleCleanClose(gen) {
    if (this.#errorFiredSinceOpen) {
      // Library sequence: onError → onClosed. Don't double-count.
      console.debug("[EventSource] stream closed after error — skipping double count");
      this.#errorFiredSinceOpen = false;
      return;
    }

    this.#consecutiveErrors++;
    this.#maybeEscalate(gen, "clean close");
    this.#maybeReconnect(gen);
  }

  /**
   * Error during stream iteration.
   * Counts toward escalation threshold.
   */
  #handleError(gen, error) {
    this.#errorFiredSinceOpen = true;
    this.#consecutiveErrors++;

    const msg = error?.message || String(error);
    console.error(`[EventSource] SSE error (${this.#consecutiveErrors} consecutive): ${msg}`);

    this.#emitState(ConnectionState.Error);

    if (!this.#maybeEscalate(gen, msg)) {
      this.#maybeReconnect(gen);
    }
  }

  /**
   * Check if consecutive errors exceeded threshold → escalate to Disconnected.
   * @returns {boolean} true if escalated
   */
  #maybeEscalate(gen, reason) {
    const max = this.#config.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;
    if (this.#consecutiveErrors >= max) {
      console.warn(`[EventSource] ${this.#consecutiveErrors} consecutive errors (threshold=${max}) — escalating to Disconnected. Reason: ${reason}`);
      this.#setState(ConnectionState.Disconnected);
      this.#escalatedListeners.forEach(fn => { try { fn(); } catch {} });
      return true;
    }
    return false;
  }

  /**
   * Schedule exponential-backoff reconnect if still on the same generation.
   */
  #maybeReconnect(gen) {
    if (this.#isShutdown || gen !== this.#generation) return;

    const delay = this.#backoffDelay(this.#consecutiveErrors);
    console.debug(`[EventSource] scheduling reconnect in ${delay}ms (attempt ${this.#consecutiveErrors})`);

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#isShutdown || gen !== this.#generation) return;
      if (this.#state === ConnectionState.Disconnected) return; // don't retry after escalation

      console.debug(`[EventSource] reconnecting (gen=${gen})`);
      this.#activeStream = null;
      this.#setState(ConnectionState.Connecting);
      this.#run(gen);
    }, delay);
  }

  /**
   * Exponential backoff: initial * 2^(attempt-1), capped at max, with 25% jitter.
   * @param {number} attempt — 1-based consecutive error count
   * @returns {number} delay in ms
   */
  #backoffDelay(attempt) {
    const base = this.#config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const max  = this.#config.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    const raw  = Math.min(base * Math.pow(2, attempt - 1), max);
    const jitter = 1 - Math.random() * 0.25;
    return Math.floor(raw * jitter);
  }

  // ─── Helpers ──────────────────────────────────────────────

  #abortStream() {
    if (this.#activeStream) {
      try { this.#activeStream.controller.abort(); } catch (e) {
        console.warn("[EventSource] error aborting SSE stream:", e?.message || e);
      }
      this.#activeStream = null;
    }
  }

  #clearReconnectTimer() {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #setState(state) {
    if (this.#state === state) return;
    this.#state = state;
    this.#emitState(state);
  }

  #emitState(state) {
    this.#stateListeners.forEach(fn => { try { fn(state); } catch {} });
  }

  /** @param {import("./connection-state.mjs").ScopedEvent<any>} event */
  #emitEvent(rawEvent) {
    const event = {
      workspaceKey: directoryKey(this.#config.directory),
      generation: this.#generation,
      event: rawEvent,
    };
    this.#eventListeners.forEach(fn => { try { fn(event); } catch {} });
  }
}
