import { createOpencodeClient } from "@opencode-ai/sdk";

let _client = null;

/**
 * Initialize the opencode SDK client, connected to an already-running
 * opencode serve instance.
 *
 * @param {string} url           - Base URL of the opencode serve instance
 * @param {string} [password]    - Basic auth password (omit if server has none)
 * @param {string} [username="opencode"] - Basic auth username
 * @returns {object} The SDK client instance
 */
export function initOpencodeClient(url, password, username = "opencode") {
  const headers = {};
  if (password) {
    headers.authorization =
      "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  }

  _client = createOpencodeClient({
    baseUrl: url,
    headers,
    responseStyle: "data",
    throwOnError: true,
  });
  return _client;
}

/**
 * Return the initialised SDK client.
 * Throws if initOpencodeClient() hasn't been called yet.
 */
export function getClient() {
  if (!_client) {
    throw new Error(
      "Opencode client not initialised – call initOpencodeClient() first."
    );
  }
  return _client;
}
