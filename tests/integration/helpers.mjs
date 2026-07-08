/**
 * Integration test helpers for Aibase.
 *
 * Shared utilities: HTTP client, wait-for-ready, session creation.
 *
 * Usage:
 *   import { get, post, waitForReady, createSession } from "./helpers.mjs";
 *
 * CLI:
 *   node tests/integration/helpers.mjs wait
 *   node tests/integration/helpers.mjs health
 */

// ─── Configuration ──────────────────────────────────────────────

export const BASE_URL = (process.env.AIBASE_TEST_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
export const MODEL = process.env.AIBASE_TEST_MODEL || "opencode/deepseek-v4-flash-free";
export const TIMEOUT_MS = parseInt(process.env.AIBASE_TEST_TIMEOUT_MS || "120000", 10);
export const SKIP_LLM = /^(1|true|yes|on)$/i.test(process.env.AIBASE_TEST_SKIP_LLM || "");

// ─── HTTP helpers ────────────────────────────────────────────────

async function request(method, path, opts = {}) {
  const url = `${BASE_URL}${path}`;
  const { body, timeout = 10000, signal } = opts;
  const headers = { ...opts.headers };
  if (body) headers["content-type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (signal) signal.addEventListener("abort", () => controller.abort());

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function get(path, opts = {}) {
  return request("GET", path, opts);
}

export async function post(path, body, opts = {}) {
  return request("POST", path, { ...opts, body }, opts);
}

export async function patch(path, body, opts = {}) {
  return request("PATCH", path, { ...opts, body }, opts);
}

export function getJson(res) {
  return res.json();
}

// ─── SSE helpers ─────────────────────────────────────────────────

/**
 * Consume SSE stream from a fetch Response, collecting events until
 * the "done" event or timeout.
 *
 * Returns { events: Array<{type, data}>, status: "done" | "timeout" | "error" }
 */
export async function collectSSE(response, opts = {}) {
  const { timeout = TIMEOUT_MS, onEvent } = opts;
  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {});
  }, timeout);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let currentEvent = { type: "message", data: "" };
      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent.type = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentEvent.data = line.slice(5).trim();
        } else if (line === "") {
          if (currentEvent.data) {
            try {
              const parsed = JSON.parse(currentEvent.data);
              events.push({ type: currentEvent.type, data: parsed });
              if (onEvent) onEvent({ type: currentEvent.type, data: parsed });
            } catch {
              events.push({ type: currentEvent.type, data: currentEvent.data });
            }
          }
          currentEvent = { type: "message", data: "" };

          if (events.length > 0 && events[events.length - 1].type === "done") {
            clearTimeout(timer);
            return { events, status: "done" };
          }
        }
      }
    }

    clearTimeout(timer);
    return { events, status: "done" };
  } catch (error) {
    clearTimeout(timer);
    if (timedOut) return { events, status: "timeout" };
    return { events, status: "error", error };
  }
}

// ─── Wait helpers ────────────────────────────────────────────────

/**
 * Poll /api/health until it returns 200 or timeout expires.
 */
export async function waitForReady(opts = {}) {
  const { timeout = 60000, interval = 2000 } = opts;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const res = await get("/api/health", { timeout: 3000 });
      if (res.ok) {
        const json = await res.json();
        if (json.status === "ok") return true;
      }
    } catch {
      // not ready yet
    }
    await sleep(interval);
  }
  return false;
}

// ─── Session helpers ─────────────────────────────────────────────

export async function createSession(opts = {}) {
  const res = await post("/api/sessions", {
    title: opts.title || "integration-test",
    permission: opts.permission,
  });
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
  const json = await res.json();
  return json;
}

// ─── Prompt helpers ───────────────────────────────────────────────

export async function sendPrompt(sessionId, text, opts = {}) {
  const res = await post(`/api/sessions/${sessionId}/prompt`, {
    text,
    model: opts.model || MODEL,
    agent: opts.agent,
    system: opts.system,
  }, { timeout: TIMEOUT_MS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`sendPrompt failed: ${res.status} ${body}`);
  }
  return res.json();
}

/**
 * Send a streaming prompt and collect all SSE events.
 */
export async function sendStreamPrompt(sessionId, text, opts = {}) {
  const body = {
    text,
    model: opts.model || MODEL,
    agent: opts.agent,
    system: opts.system,
  };

  const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}/prompt/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`sendStreamPrompt failed: ${res.status}`);
  }

  const result = await collectSSE(res, { timeout: TIMEOUT_MS });
  return result;
}

/**
 * Get messages for a session.
 */
export async function getMessages(sessionId, opts = {}) {
  const res = await get(`/api/sessions/${sessionId}/messages?limit=${opts.limit || 50}`);
  if (!res.ok) throw new Error(`getMessages failed: ${res.status}`);
  return res.json();
}

/**
 * Poll until an assistant message appears, or timeout.
 */
export async function waitForAssistantMessage(sessionId, opts = {}) {
  const { timeout = TIMEOUT_MS, interval = 2000 } = opts;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const messages = await getMessages(sessionId);
    const assistantMsgs = messages.filter(
      m => m.role === "assistant" && m.parts?.some(p => p.type === "text" && p.text?.trim())
    );
    if (assistantMsgs.length > 0) return assistantMsgs;
    await sleep(interval);
  }
  return [];
}

// ─── Utilities ────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── CLI ─────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("helpers.mjs")) {
  const cmd = process.argv[2];
  if (cmd === "wait") {
    console.log(`Waiting for ${BASE_URL} to become ready...`);
    const ready = await waitForReady();
    if (ready) {
      console.log("Ready.");
      process.exit(0);
    } else {
      console.error("Timed out waiting for Aibase.");
      process.exit(1);
    }
  } else if (cmd === "health") {
    const res = await get("/api/health");
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
  } else {
    console.log(`Usage: node helpers.mjs <wait|health>`);
  }
}
