/**
 * Integration test: Health endpoint
 *
 * Verifies:
 *   - GET /api/health returns 200 with json
 *   - Response includes name, status fields
 *   - opencode kernel URL is present
 */

import test from "node:test";
import assert from "node:assert/strict";
import { get, waitForReady, BASE_URL } from "./helpers.mjs";

let ready = false;

test("wait for aibase readiness", async () => {
  ready = await waitForReady({ timeout: 120000 });
  assert.ok(ready, `Aibase not ready at ${BASE_URL} after 120s`);
});

function requireReady() {
  if (!ready) throw new Error("SKIP: aibase not ready");
}

test("GET /api/health returns ok status", async () => {
  requireReady();
  const res = await get("/api/health");
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(typeof json.name, "string", "name should be a string");
  assert.ok(["ok", "opencode_unavailable"].includes(json.status), `unexpected status: ${json.status}`);
  assert.ok(json.opencode?.url, "opencode.url should be present");
});

test("GET /api/health response is valid JSON with expected shape", async () => {
  requireReady();
  const res = await get("/api/health");
  assert.equal(res.status, 200);

  const json = await res.json();

  // Required top-level fields
  assert.equal(typeof json.name, "string");
  assert.equal(typeof json.workspace, "string");
  assert.ok(["ok", "opencode_unavailable"].includes(json.status), `unexpected status: ${json.status}`);

  // opencode sub-object
  assert.ok(json.opencode, "opencode field missing");
  assert.equal(typeof json.opencode.url, "string", "opencode.url should be string");
});
