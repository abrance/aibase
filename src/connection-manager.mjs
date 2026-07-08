/**
 * ConnectionManager — mirrors P4OC's ConnectionManager.
 *
 * Responsibilities:
 *   1. Create and configure @opencode-ai/sdk client (replaces global singleton)
 *   2. Create and manage EventSourceManager (SSE lifecycle)
 *   3. Hydration-aware event subscription (buffer during hydrate, replay after)
 *   4. Connection state forwarding
 *
 * For single-workspace aibase this is simpler than P4OC (no multi-tab routing,
 * no WebSocket, no connection pool), but the interface is designed so those
 * can be added later.
 */

import { createOpencodeClient } from "@opencode-ai/sdk";
import { ConnectionState } from "./connection-state.mjs";
import { EventSourceManager } from "./event-source.mjs";
import { HydrationEventBuffer } from "./event-buffer.mjs";

/**
 * Default opencode serve port. When the user provides a URL with this port,
 * we also try the standard HTTP/HTTPS port as a fallback (the server may be
 * proxied through nginx/traefik on 80/443).
 */
const OPENCODE_DEFAULT_PORT = 4096;

/**
 * Generate connection URL candidates from a base URL.
 * Mirrors P4OC's ConnectionManager.connectionCandidates().
 *
 * When the base URL uses the standard opencode port (4096), a fallback URL
 * with the standard scheme port (80/443) is appended. This handles the common
 * case where a server is exposed behind a reverse proxy.
 *
 * @param {string} baseUrl
 * @returns {string[]}
 */
function connectionCandidates(baseUrl) {
  const trimmed = baseUrl.trimEnd("/");
  const candidates = [trimmed];

  try {
    const parsed = new URL(trimmed);

    // Only generate fallback when using the default opencode port
    if (parsed.port === String(OPENCODE_DEFAULT_PORT)) {
      const fallbackPort = parsed.protocol === "https:" ? "443" : "80";
      // Don't add fallback if it would be identical (unlikely but defensive)
      if (fallbackPort !== parsed.port) {
        const fallback = `${parsed.protocol}//${parsed.hostname}:${fallbackPort}${parsed.pathname}`.replace(/\/$/, "");
        if (fallback !== trimmed) {
          candidates.push(fallback);
        }
      }
    }
  } catch {
    // URL parsing failed — just return the raw string
  }

  return candidates;
}

export class ConnectionManager {
  /** @type {string[]} */
  #candidateUrls;

  /** @type {string} */
  #directory;

  /** @type {string | undefined} */
  #password;

  /** @type {import("@opencode-ai/sdk").Opencode} */
  #client;

  /** @type {EventSourceManager} */
  #eventSource;

  /** @type {HydrationEventBuffer | null} */
  #hydrateBuffer = null;

  /** @type {string} */
  #connectionState = ConnectionState.Disconnected;

  /** @type {Array<(state: string) => void>} */
  #stateListeners = [];

  /** @type {Array<(event: import("./connection-state.mjs").ScopedEvent<any>) => void>} */
  #eventListeners = [];

  /**
   * @param {{ baseUrl: string, directory: string, password?: string }} params
   */
  constructor({ baseUrl, directory, password }) {
    this.#candidateUrls = connectionCandidates(baseUrl);
    this.#directory = directory;
    this.#password = password;

    console.debug(`[ConnectionManager] candidates: ${this.#candidateUrls.join(", ")}`);

    // Create the SDK client (replaces the old global singleton)
    this.#client = this.#buildClient();

    // Create the EventSource manager — uses the primary (first) candidate
    this.#eventSource = new EventSourceManager(
      { baseUrl: this.#candidateUrls[0], directory },
      this.#client,
    );

    // Single internal event handler: routes to buffer or downstream listeners
    this.#eventSource.onEvent((scopedEvent) => {
      if (this.#hydrateBuffer) {
        // Hydration mode: buffer event, don't forward
        this.#hydrateBuffer.buffer(scopedEvent);
      } else {
        // Normal mode: forward to all registered listeners
        this.#eventListeners.forEach(fn => {
          try { fn(scopedEvent); } catch {}
        });
      }
    });

    // Forward EventSource state changes
    this.#eventSource.onState((state) => {
      this.#connectionState = state;
      this.#stateListeners.forEach(fn => { try { fn(state); } catch {} });
    });

    // Forward escalation
    this.#eventSource.onEscalated(() => {
      console.warn("[ConnectionManager] SSE escalated to Disconnected");
    });
  }

  // ─── Public read-only ────────────────────────────────────

  /** @returns {string} The resolved (primary) base URL used for connections. */
  get baseUrl() { return this.#candidateUrls[0]; }

  /** @returns {import("@opencode-ai/sdk").Opencode} */
  get client() { return this.#client; }

  /** @returns {string} */
  get connectionState() { return this.#connectionState; }

  /** @returns {boolean} */
  get isConnected() { return this.#connectionState === ConnectionState.Connected; }

  /** @returns {number} */
  get generation() { return this.#eventSource.generation; }

  /** @returns {number} Current consecutive error count from the EventSource. */
  get consecutiveErrors() { return this.#eventSource.consecutiveErrors; }

  // ─── Event listeners ─────────────────────────────────────

  /**
   * Register a connection state listener.
   * @param {(state: string) => void} fn
   * @returns {() => void} unsubscribe function
   */
  onStateChange(fn) {
    this.#stateListeners.push(fn);
    return () => {
      const idx = this.#stateListeners.indexOf(fn);
      if (idx >= 0) this.#stateListeners.splice(idx, 1);
    };
  }

  /**
   * Register a downstream event listener.
   * During hydration, events are buffered and NOT forwarded to listeners.
   * After hydration ends, events flow directly.
   *
   * @param {(event: import("./connection-state.mjs").ScopedEvent<any>) => void} fn
   * @returns {() => void} unsubscribe function
   */
  onEvent(fn) {
    this.#eventListeners.push(fn);
    return () => {
      const idx = this.#eventListeners.indexOf(fn);
      if (idx >= 0) this.#eventListeners.splice(idx, 1);
    };
  }

  // ─── Lifecycle ───────────────────────────────────────────

  /** Start SSE connection (fire-and-forget — does not wait for establishment). */
  connect() {
    this.#eventSource.connect();
  }

  /**
   * Start SSE connection and wait for it to reach Connected state.
   * Useful at startup to ensure the connection is ready before accepting requests.
   *
   * @param {number} [timeoutMs=30_000] — max wait time in ms
   * @returns {Promise<void>}
   */
  async ensureConnected(timeoutMs = 30_000) {
    if (this.isConnected) return;

    this.connect();

    if (this.isConnected) return;

    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(`EventSourceManager did not connect within ${timeoutMs}ms`)),
        timeoutMs,
      );
      const unsub = this.onStateChange((state) => {
        if (state === ConnectionState.Connected) {
          clearTimeout(t);
          unsub();
          resolve();
        }
      });
      // Check once more in case it connected between the check and now
      if (this.isConnected) {
        clearTimeout(t);
        unsub();
        resolve();
      }
    });
  }

  /** Clean disconnect with SSE shutdown. */
  disconnect() {
    this.#eventSource.disconnect();
  }

  /** Permanent shutdown — disposes SDK client connection. */
  shutdown() {
    this.#eventSource.shutdown();
    this.#hydrateBuffer?.clear();
    this.#hydrateBuffer = null;
    this.#stateListeners.length = 0;
    this.#eventListeners.length = 0;
  }

  /**
   * Reset and reconnect — for foreground resume.
   * Resets error counter, then issues lightweight reconnect.
   */
  reconnect() {
    this.#eventSource.resetConsecutiveErrors();
    this.#eventSource.connect();
  }

  // ─── Hydration buffer ────────────────────────────────────

  /**
   * Begin hydration mode. SSE events received during hydrate are buffered
   * rather than forwarded directly to listeners. Must call endHydrate()
   * to replay buffered events.
   *
   * Usage:
   *   conn.startHydrate();
   *   conn.connect();                          // SSE starts, events go to buffer
   *   const snapshot = await loadRestData();   // REST hydration
   *   const result = conn.endHydrate(snapshot, reducer);  // replay buffer → snapshot
   */
  startHydrate() {
    if (this.#hydrateBuffer) {
      console.warn("[ConnectionManager] hydrate already in progress — clearing old buffer");
      this.#hydrateBuffer.clear();
    }
    this.#hydrateBuffer = new HydrationEventBuffer();
  }

  /**
   * End hydration mode. Replays buffered events through the reducer
   * and returns the final state. Stops buffering future events
   * (they flow directly to listeners from now on).
   *
   * @template T
   * @param {T} initialState
   * @param {(state: T, scopedEvent: import("./connection-state.mjs").ScopedEvent<any>) => T} reducer
   * @returns {{ state: T, bufferedCount: number }}
   */
  endHydrate(initialState, reducer) {
    if (!this.#hydrateBuffer) {
      return { state: initialState, bufferedCount: 0 };
    }

    const bufferedCount = this.#hydrateBuffer.size;
    const finalState = this.#hydrateBuffer.replayOver(initialState, reducer);
    this.#hydrateBuffer.clear();
    this.#hydrateBuffer = null;

    return { state: finalState, bufferedCount };
  }

  // ─── Internal ─────────────────────────────────────────────

  #buildClient() {
    const headers = {};
    if (this.#password) {
      headers.authorization =
        "Basic " + Buffer.from(`opencode:${this.#password}`).toString("base64");
    }

    return createOpencodeClient({
      baseUrl: this.#candidateUrls[0],
      headers,
      responseStyle: "data",
      throwOnError: true,
    });
  }
}
