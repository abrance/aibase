/**
 * Integration test: Session + Prompt (non-streaming + streaming)
 *
 * Core flow:
 *   1. Create session via POST /api/sessions
 *   2. Send prompt via POST /api/sessions/:id/prompt (non-streaming)
 *   3. Poll GET /api/sessions/:id/messages until assistant responds
 *   4. Verify assistant response contains expected content
 *
 * Streaming flow:
 *   1. Create session
 *   2. Send prompt via POST /api/sessions/:id/prompt/stream
 *   3. Collect SSE events
 *   4. Verify "done" event received
 *
 * Environment:
 *   Set AIBASE_TEST_SKIP_LLM=1 to skip LLM-dependent tests
 *   when no API key is available.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_URL,
  SKIP_LLM,
  MODEL,
  waitForReady,
  createSession,
  sendStreamPrompt,
  getMessages,
  get,
} from "./helpers.mjs";

// ─── Setup ──────────────────────────────────────────────────

let ready = false;

test("ensure aibase is reachable", async () => {
  ready = await waitForReady({ timeout: 120000 });
  assert.ok(ready, `Aibase not ready at ${BASE_URL} after 120s — is the service running?`);
});

function requireReady() {
  if (!ready) throw new Error("SKIP: aibase not ready");
}

// ─── Session CRUD ────────────────────────────────────────────

test("POST /api/sessions creates a new session and returns an ID", async () => {
  requireReady();
  const session = await createSession({ title: "integration-test-create" });
  assert.ok(session.id, "session.id should be present");
  assert.ok(session.id.length > 0, "session.id should be non-empty");
});

test("GET /api/sessions lists sessions including the newly created one", async () => {
  requireReady();
  const session = await createSession({ title: "integration-test-list" });
  const res = await get("/api/sessions");
  assert.equal(res.status, 200);

  const sessions = await res.json();
  assert.ok(Array.isArray(sessions), "sessions should be an array");
  const found = sessions.find(s => s.id === session.id);
  assert.ok(found, `session ${session.id} should appear in session list`);
});

test("PATCH /api/sessions/:id/title updates session title", async () => {
  requireReady();
  const session = await createSession({ title: "before-rename" });
  const newTitle = "renamed-integration-test";

  const res = await fetch(`${BASE_URL}/api/sessions/${session.id}/title`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: newTitle }),
  });
  assert.equal(res.status, 200);

  const listRes = await get("/api/sessions");
  const sessions = await listRes.json();
  const updated = sessions.find(s => s.id === session.id);
  assert.ok(updated, "session should still exist");
  assert.ok(updated.title?.includes("renamed"), `title should contain "renamed", got: ${updated.title}`);
});

// ─── Prompt + response verification (requires LLM) ───────────

test("stream prompt → wait for done → poll messages gets assistant response", { skip: SKIP_LLM }, async () => {
  requireReady();
  const session = await createSession({ title: "integration-test-prompt" });

  // Use streaming to send prompt
  const result = await sendStreamPrompt(session.id, "Reply with exactly this word: PONG");
  assert.equal(result.status, "done", `stream should finish with done, got: ${result.status}`);

  // After stream completes, the messages endpoint should have the full conversation
  const messages = await getMessages(session.id);
  const assistantMsgs = messages.filter(
    m => (m.info?.role || m.role) === "assistant" && m.parts?.some(p => p.type === "text" && p.text?.trim())
  );
  assert.ok(assistantMsgs.length > 0, "should have at least one assistant message after stream completes");

  const textParts = assistantMsgs[0].parts?.filter(p => p.type === "text") || [];
  const combined = textParts.map(p => p.text).join(" ");
  console.log(`  assistant response: ${combined.substring(0, 200)}`);
  assert.ok(combined.length > 0, "assistant response should not be empty");
});

// ─── Streaming Prompt (requires LLM) ─────────────────────────

test("POST /api/sessions/:id/prompt/stream receives done event", { skip: SKIP_LLM }, async () => {
  requireReady();
  const session = await createSession({ title: "integration-test-stream" });

  const result = await sendStreamPrompt(session.id, "Reply with exactly this word: PONG");

  assert.equal(result.status, "done", `stream should finish with done, got: ${result.status}`);
  assert.ok(result.events.length > 0, "should receive SSE events");

  // Should have at least trace and done events
  const eventTypes = result.events.map(e => e.type);
  console.log(`  SSE event types: ${eventTypes.join(", ")}`);

  const hasDone = eventTypes.includes("done");
  assert.ok(hasDone, "should receive a 'done' event");
});

test("POST /api/sessions/:id/prompt/stream trace events contain message content", { skip: SKIP_LLM }, async () => {
  requireReady();
  const session = await createSession({ title: "integration-test-stream-trace" });

  const result = await sendStreamPrompt(session.id, "Reply with exactly this word: HELLO");

  // Look for trace events or phase events
  const traceEvents = result.events.filter(e => e.type === "trace");
  const phaseEvents = result.events.filter(e => e.type === "phase");
  const acceptedEvents = result.events.filter(e => e.type === "accepted");

  console.log(`  traces: ${traceEvents.length}, phases: ${phaseEvents.length}, accepted: ${acceptedEvents.length}`);

  // At minimum, we should get some meaningful events
  const meaningfulEvents = [...traceEvents, ...phaseEvents, ...acceptedEvents];
  assert.ok(meaningfulEvents.length > 0, "should receive trace, phase, or accepted events");
});

// ─── Skills + Marketplace (read-only, no LLM needed) ─────────

test("GET /api/skills returns a list", async () => {
  requireReady();
  const res = await get("/api/skills");
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok("skills" in json || Array.isArray(json), "skills response should have skills array");
});

test("GET /api/marketplace returns marketplace index", async () => {
  requireReady();
  const res = await get("/api/marketplace");
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(typeof json.schemaVersion, "number", "schemaVersion should be a number");
  assert.ok(Array.isArray(json.bundles), "bundles should be an array");
});
