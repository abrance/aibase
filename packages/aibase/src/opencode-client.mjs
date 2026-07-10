/**
 * Opencode SDK client factory.
 *
 * Creates typed SDK clients for the opencode serve HTTP API.
 * The client is now owned by ConnectionManager — there is no global singleton.
 *
 * Use ConnectionManager.client to access the configured client:
 *
 *   const conn = new ConnectionManager({ baseUrl, directory, password });
 *   const sessions = await conn.client.session.list({ ... });
 */

import { createOpencodeClient } from "@opencode-ai/sdk";

/**
 * Create a new opencode SDK client.
 *
 * @param {{ baseUrl: string, password?: string, username?: string }} opts
 * @returns {import("@opencode-ai/sdk").Opencode}
 */
export function createClient({ baseUrl, password, username = "opencode" }) {
  const headers = {};
  if (password) {
    headers.authorization =
      "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  }

  return createOpencodeClient({
    baseUrl,
    headers,
    responseStyle: "data",
    throwOnError: true,
  });
}

// ─── Legacy exports (for gradual migration) ──────────────────────

let _legacyClient = null;

/**
 * @deprecated Use ConnectionManager instead.
 * Initialize the legacy singleton client.
 */
export function initOpencodeClient(url, password, username = "opencode") {
  _legacyClient = createClient({ baseUrl: url, password, username });
  return _legacyClient;
}

/**
 * @deprecated Use ConnectionManager.client instead.
 * Return the legacy singleton client. Throws if not initialized.
 */
export function getClient() {
  if (!_legacyClient) {
    throw new Error(
      "Opencode client not initialised – use ConnectionManager or call initOpencodeClient() first."
    );
  }
  return _legacyClient;
}
