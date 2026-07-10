/**
 * aibase-sdk — lightweight browser client for the aibase API.
 *
 * Zero dependencies.  Works as an ES module or via a <script> tag.
 *
 * @version 0.1.0
 * @license MIT
 *
 * # Quick start
 *
 *   import { createAibaseClient } from "./aibase-sdk.js";
 *   const api = createAibaseClient({ baseUrl: "http://localhost:3001" });
 *
 *   // Create a session and stream a prompt
 *   const session = await api.sessions.create({ title: "Hello" });
 *   await api.sessions.promptStream(session.id, { text: "Hi!" }, (event, data) => {
 *     if (event === "assistant") console.log(data.text);
 *     if (event === "done")      console.log("Finished");
 *   });
 */

export function createAibaseClient(options = {}) {
  const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * JSON request / response.
   * Throws on HTTP errors.
   */
  async function requestJson(path, opts = {}) {
    const headers = { "content-type": "application/json", ...opts.headers };
    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    const res = await fetch(`${baseUrl}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body,
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = payload?.message ?? payload?.error ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return payload;
  }

  /**
   * Parse one SSE block (lines delimited by \n\n).
   * Returns `{ event, data }` or null for empty blocks.
   */
  function parseSseBlock(rawBlock) {
    let event = "message";
    const dataLines = [];

    for (const line of rawBlock.split("\n")) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("event:")) {
        event = trimmed.slice(6).trim();
      } else if (trimmed.startsWith("data:")) {
        dataLines.push(trimmed.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) return null;

    try {
      return { event, data: JSON.parse(dataLines.join("\n")) };
    } catch {
      return { event, data: dataLines.join("\n") };
    }
  }

  /**
   * Async generator that yields SSE `{ event, data }` from a ReadableStream.
   */
  async function* readSseStream(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replaceAll("\r\n", "\n");

      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const block = parseSseBlock(raw);
        if (block) yield block;

        idx = buffer.indexOf("\n\n");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    /**
     * Health check.
     * Returns workspace path, opencode status, skill / MCP roots, etc.
     */
    async health() {
      return requestJson("/api/health");
    },

    // ---- Sessions -----------------------------------------------------------

    sessions: {
      /**
       * List sessions.
       * @param {{ archived?, search?, limit? }} opts
       */
      async list(opts = {}) {
        const p = new URLSearchParams();
        if (opts.archived) p.set("archived", "true");
        if (opts.search) p.set("search", opts.search);
        if (opts.limit) p.set("limit", String(opts.limit));
        const qs = p.toString();
        return requestJson(`/api/sessions${qs ? "?" + qs : ""}`);
      },

      /**
       * Create a new session.
       * @param {{ title?, permission? }} param0
       * @returns session object (includes `.id`)
       */
      async create({ title, permission } = {}) {
        return requestJson("/api/sessions", {
          method: "POST",
          body: { title, permission },
        });
      },

      /**
       * Fetch messages for a session.
       * @param {string} sessionId
       * @param {number} [limit=100]
       */
      async getMessages(sessionId, limit = 100) {
        return requestJson(
          `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`,
        );
      },

      /**
       * Send a prompt (non-streaming). Returns the completed response.
       * @param {string} sessionId
       * @param {object} body
       * @param {string} body.text    — prompt content
       * @param {string} [body.agent]   — agent name (optional)
       * @param {string} [body.model]   — model override (optional)
       * @param {string} [body.system]  — system message (optional)
       */
      async prompt(sessionId, { text, agent, model, system } = {}) {
        return requestJson(
          `/api/sessions/${encodeURIComponent(sessionId)}/prompt`,
          {
            method: "POST",
            body: { text, agent, model, system },
          },
        );
      },

      /**
       * Send a prompt with SSE streaming.
       *
       * SSE events fired by the server:
       *   phase     — progress label (e.g. "正在分析", "正在生成", "正在调用工具")
       *   trace     — detailed logging / timeline entries (for debug UIs)
       *   assistant — incremental text from the model
       *               `{ messageID, text }`
       *   permission — tool-permission request that needs user approval
       *                `{ id, type, pattern, title, command }`
       *   accepted  — prompt was accepted by the kernel
       *   error     — error message
       *   messages  — final message array after completion
       *   done      — stream finished
       *
       * @param {string} sessionId
       * @param {object} body        — same shape as `prompt()`
       * @param {function} onEvent   — (event, data) => void
       *                              Called for each SSE event until "done"
       *                              or "error".
       */
      async promptStream(sessionId, { text, agent, model, system } = {}, onEvent) {
        const res = await fetch(
          `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/prompt/stream`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text, agent, model, system }),
          },
        );

        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.message ?? err?.error ?? `HTTP ${res.status}`);
        }

        for await (const { event, data } of readSseStream(res.body)) {
          onEvent(event, data);
          if (event === "done") break;
        }
      },

      /**
       * Update session title.
       */
      async updateTitle(sessionId, title) {
        return requestJson(
          `/api/sessions/${encodeURIComponent(sessionId)}/title`,
          {
            method: "PATCH",
            body: { title },
          },
        );
      },

      /**
       * Archive (or unarchive) a session.
       * @param {string}  sessionId
       * @param {boolean} [archived=true]
       */
      async archive(sessionId, archived = true) {
        return requestJson(
          `/api/sessions/${encodeURIComponent(sessionId)}/archive`,
          {
            method: "PATCH",
            body: { archived },
          },
        );
      },

      /**
       * Respond to a permission request (allow or deny tool execution).
       * Called after receiving a `permission` SSE event.
       *
       * @param {string}  sessionId
       * @param {string}  permissionId  — from the permission event's `id` field
       * @param {boolean} allow
       */
      async respondPermission(sessionId, permissionId, allow) {
        return requestJson(
          `/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionId)}`,
          {
            method: "POST",
            body: { allow },
          },
        );
      },
    },
  };
}
