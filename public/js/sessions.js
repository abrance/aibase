import { state, setBusy } from "./state.js";
import { elements, defaultSessionTitles } from "./elements.js";
import { escapeHtml, formatTime } from "./utils.js";
import { requestJson } from "./api.js";
import { loadAndShowMessages } from "./chat.js";

async function loadSessionsImpl() {
  try {
    state.sessions = await requestJson("/api/sessions");
  } catch (error) {
    state.sessions = [];
  }
}

export function renderSessions() {
  elements.sessions.innerHTML = "";

  if (state.sessions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No sessions yet.";
    elements.sessions.append(empty);
    return;
  }

  for (const session of state.sessions) {
    const item = document.createElement("article");
    item.className = "session-item";
    item.setAttribute("aria-current", String(session.id === state.currentSessionID));

    const button = document.createElement("button");
    button.className = "session-main-button";
    button.type = "button";
    button.innerHTML = `
      <span class="session-main">
        <strong>${escapeHtml(session.title || "Untitled")}</strong>
        <span>${formatTime(session.time?.updated || session.time?.created)}</span>
      </span>
    `;
    button.addEventListener("click", async () => {
      state.currentSessionID = session.id;
      state.messagesPinnedToBottom = true;
      renderSessions();
      await loadAndShowMessages();
    });
    item.append(button);

    const archive = document.createElement("button");
    archive.className = "session-archive";
    archive.type = "button";
    archive.title = "归档会话";
    archive.setAttribute("aria-label", `归档 ${session.title || "session"}`);
    archive.disabled = state.archivingSessionID === session.id;
    archive.textContent = "归档";
    archive.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await archiveSession(session.id);
    });
    item.append(archive);
    elements.sessions.append(item);
  }
}

export async function createSession() {
  setBusy(true, "Creating session");
  try {
    const session = await requestJson("/api/sessions", {
      method: "POST",
      body: { title: "Aibase session" },
    });
    state.currentSessionID = session.id;
    state.messagesPinnedToBottom = true;
    await loadSessionsImpl();
    renderSessions();
    await loadAndShowMessages();
  } catch (error) {
    console.error("Session creation failed:", error);
  } finally {
    setBusy(false);
  }
}

export async function archiveSession(sessionID) {
  if (!sessionID || state.archivingSessionID) return;
  state.archivingSessionID = sessionID;
  renderSessions();
  try {
    await requestJson(`/api/sessions/${encodeURIComponent(sessionID)}/archive`, {
      method: "PATCH",
      body: { archived: true },
    });
    state.sessions = state.sessions.filter((session) => session.id !== sessionID);
    if (state.currentSessionID === sessionID) {
      state.currentSessionID = state.sessions[0]?.id || null;
      state.messagesPinnedToBottom = true;
      renderSessions();
      await loadAndShowMessages();
    } else {
      renderSessions();
    }
  } catch (error) {
    console.error("Session archive failed:", error);
  } finally {
    state.archivingSessionID = null;
    renderSessions();
  }
}

export function isDefaultSessionTitle(title) {
  return defaultSessionTitles.has(String(title || "").trim());
}

export function applySessionTitle(sessionID, title) {
  const session = state.sessions.find((item) => item.id === sessionID);
  if (session) {
    session.title = title;
    session.time = { ...(session.time || {}), updated: Date.now() };
  }
  if (sessionID === state.currentSessionID) {
    elements.sessionTitle.textContent = title;
  }
  renderSessions();
}

export async function autoTitleSession(sessionID, text) {
  const session = state.sessions.find((item) => item.id === sessionID);
  if (!isDefaultSessionTitle(session?.title)) return;

  const title = summarizeSessionTitle(text);
  if (!title) return;

  applySessionTitle(sessionID, title);

  try {
    const updated = await requestJson(`/api/sessions/${encodeURIComponent(sessionID)}/title`, {
      method: "PATCH",
      body: { title },
    });
    applySessionTitle(sessionID, updated.title || title);
  } catch (error) {
    console.warn("Session title update failed", error);
  }
}

export function summarizeSessionTitle(text) {
  const helperLine = /^Use the .+ (skill|MCP tools) (for|when)\b/i;
  const withoutHelpers = String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !helperLine.test(line))
    .join(" ");

  const urls = withoutHelpers.match(/https?:\/\/\S+/g) || [];
  let title = withoutHelpers.replace(/https?:\/\/\S+/g, " ").trim();
  if (!title && urls.length > 0) {
    try {
      title = new URL(urls[0]).hostname;
    } catch {
      title = urls[0];
    }
  }

  title = title
    .replace(/[`*_#>\[\](){}]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(请|麻烦你?|帮我|给我|帮忙|可以|能不能|能否)\s*/i, "")
    .replace(/^看一下\s*/i, "")
    .replace(/^分析一下\s*/i, "分析")
    .replace(/[，。！？；：,.!?;:]+$/g, "")
    .trim();

  const sentence = title.split(/[。！？!?；;\n]/).find((item) => item.trim()) || title;
  title = sentence.trim();

  if (!title) return "New session";
  if (title.length <= 28) return title;
  return `${title.slice(0, 28).trim()}...`;
}
