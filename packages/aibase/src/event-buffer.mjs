/**
 * HydrationEventBuffer — mirrors P4OC's HydrationEventBuffer.
 *
 * Used during session hydration (REST snapshot load) to buffer live SSE events.
 * After the REST snapshot is applied, buffered events are replayed through
 * a reducer to bring the in-memory state up to date.
 *
 * Design (from P4OC Lock B):
 *   1. Buffer while hydrate is in progress (prevent loss)
 *   2. 512 capacity, drop-oldest overflow policy
 *   3. Replay buffer events through reducer after hydrate completes
 *   4. Thread-safe via internal lock (in JS: single-threaded, no lock needed)
 */

export const DEFAULT_BUFFER_CAPACITY = 512;

export class HydrationEventBuffer {
  /** @type {number} */
  #capacity;

  /** @type {Array<any>} */
  #events;

  /**
   * @param {number} [capacity=512]
   */
  constructor(capacity = DEFAULT_BUFFER_CAPACITY) {
    if (capacity <= 0) {
      throw new Error("Buffer capacity must be positive");
    }
    this.#capacity = capacity;
    this.#events = [];
  }

  /** Current number of buffered events. */
  get size() {
    return this.#events.length;
  }

  /**
   * Buffer an event. Drops oldest if at capacity.
   * @param {any} event
   * @returns {{ buffered: boolean, dropped: boolean, size: number }}
   */
  buffer(event) {
    let dropped = false;
    if (this.#events.length >= this.#capacity) {
      this.#events.shift();
      dropped = true;
    }
    this.#events.push(event);
    return { buffered: true, dropped, size: this.#events.length };
  }

  /**
   * Replay all buffered events through a reducer function.
   *
   * @template T
   * @param {T} initialState — the state before buffered events
   * @param {(state: T, event: any) => T} reducer — pure function, called for each event
   * @returns {T} the state after all buffered events are applied
   */
  replayOver(initialState, reducer) {
    return this.#events.reduce((state, event) => reducer(state, event), initialState);
  }

  /**
   * Snapshot current buffer contents (non-destructive).
   * @returns {Array<any>}
   */
  snapshot() {
    return [...this.#events];
  }

  /**
   * Clear all buffered events.
   */
  clear() {
    this.#events.length = 0;
  }
}
