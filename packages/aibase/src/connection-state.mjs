/**
 * Connection lifecycle states — mirrors P4OC's ConnectionState sealed class.
 *
 *   Disconnected → Connecting → Connected → Error → Disconnected
 *                                     ↑        ↓
 *                                     └────────┘ (retry)
 */

/** @enum {string} */
export const ConnectionState = Object.freeze({
  Disconnected: "disconnected",
  Connecting:   "connecting",
  Connected:    "connected",
  Error:        "error",
});

/**
 * Workspace key type — simplified for single-workspace aibase.
 * Interface is designed so a multi-workspace mode can add
 * `Directory(path)` and `SessionScoped(id)` variants later
 * without changing subscribers.
 *
 * @typedef {{ type: "global" }} GlobalWorkspaceKey
 * @typedef {{ type: "directory", path: string }} DirectoryWorkspaceKey
 * @typedef {GlobalWorkspaceKey | DirectoryWorkspaceKey} WorkspaceKey
 */

/** @returns {GlobalWorkspaceKey} */
export function globalKey() {
  return { type: "global" };
}

/** @param {string} path @returns {DirectoryWorkspaceKey} */
export function directoryKey(path) {
  return { type: "directory", path };
}

/**
 * Scoped event envelope — mirrors P4OC's ScopedEvent.
 *
 * @template T
 * @typedef {{ workspaceKey: WorkspaceKey, generation: number, event: T }} ScopedEvent
 */

/**
 * SSE event source configuration.
 *
 * @typedef {{
 *   baseUrl: string,
 *   directory: string,
 *   username?: string,
 *   password?: string,
 *   maxConsecutiveErrors?: number,
 *   retryDelayMs?: number,
 *   maxRetryDelayMs?: number,
 *   healthProbeTimeoutMs?: number,
 * }} EventSourceConfig
 */

/** Default consecutive errors before escalation to Disconnected. */
export const DEFAULT_MAX_CONSECUTIVE_ERRORS = 15;

/** Default initial retry delay in ms. */
export const DEFAULT_RETRY_DELAY_MS = 3000;

/** Maximum retry delay in ms (exponential backoff cap). */
export const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;

/** Default health probe timeout in ms before degrading to direct SSE connection. */
export const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 5_000;
