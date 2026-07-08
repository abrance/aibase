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

export class ConnectionManager {
  /** @type {string} */
  #baseUrl;

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
    this.#baseUrl = baseUrl;
    this.#directory = directory;
    this.#password = password;

    // Create the SDK client (replaces the old global singleton)
    this.#client = this.#buildClient();

    // Create the EventSource manager
    this.#eventSource = new EventSourceManager(
      { baseUrl, directory },
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

  /** @returns {import("@opencode-ai/sdk").Opencode} */
  get client() { return this.#client; }

  /** @returns {string} */
  get connectionState() { return this.#connectionState; }

  /** @returns {boolean} */
  get isConnected() { return this.#connectionState === ConnectionState.Connected; }

  /** @returns {number} */
  get generation() { return this.#eventSource.generation; }

  // ─── Event listeners ─────────────────────────────────────

  /** @param {(state: string) => void} fn */
  onStateChange(fn) { this.#stateListeners.push(fn); }

  /**
   * Register a downstream event listener.
   * During hydration, events are buffered and NOT forwarded to listeners.
   * After hydration ends, events flow directly.
   *
   * @param {(event: import("./connection-state.mjs").ScopedEvent<any>) => void} fn
   */
  onEvent(fn) { this.#eventListeners.push(fn); }

  // ─── Lifecycle ───────────────────────────────────────────

  /** Start SSE connection. */
  connect() {
    this.#eventSource.connect();
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
      baseUrl: this.#baseUrl,
      headers,
      responseStyle: "data",
      throwOnError: true,
    });
  }
}
