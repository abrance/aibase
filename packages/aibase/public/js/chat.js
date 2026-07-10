import {
  state,
  isPromptPending,
  getPendingLabel,
  finishThinking,
  resetAnswerDetail,
  rememberAnswerDetail,
  rememberAnswerDetailsFromMessages,
  storeAnswerDetailForMessages,
  getAnswerDetailConfig,
  resetThinking,
  addThinkingEntry,
  shouldRenderThinking,
  hasPendingPermissions,
  removePermission,
  addPermission,
} from "./state.js";
import { elements } from "./elements.js";
import { escapeHtml, formatShortTime } from "./utils.js";
import { renderMarkdown } from "./markdown.js";
import { requestJson, readSseStream, loadSessions } from "./api.js";

export async function loadAndShowMessages() {
  if (!state.currentSessionID) {
    elements.sessionTitle.textContent = "Aibase Console";
    showEmpty("Create a session to begin.");
    return;
  }
  const session = state.sessions.find((item) => item.id === state.currentSessionID);
  elements.sessionTitle.textContent = session?.title || "Aibase session";
  try {
    const messages = await requestJson(
      `/api/sessions/${encodeURIComponent(state.currentSessionID)}/messages`
    );
    renderMessages(messages);
  } catch (error) {
    showEmpty(`Message loading failed: ${error.message}`);
  }
}

export function renderMessages(messages) {
  const shouldStickToBottom = state.messagesPinnedToBottom || !hasScrollableMessages();
  state.messages = messages || [];
  elements.messages.innerHTML = "";

  const visibleMessages = collectVisibleMessages(state.messages);
  addOptimisticMessages(visibleMessages);
  const streamingAssistant = getStreamingAssistant(visibleMessages);

  if (visibleMessages.length === 0 && !isPromptPending() && !state.streamError) {
    showEmpty("This session is ready.");
    return;
  }

  const thinkingVisible = shouldRenderThinking();
  const completedThinking = thinkingVisible && !state.thinkingActive;
  const lastAssistantIndex = findLastAssistantIndex(visibleMessages);
  const canRenderAnswerDetail = !isPromptPending() && !streamingAssistant;
  const detailConfig = canRenderAnswerDetail
    ? getAnswerDetailConfig(lastAssistantIndex, visibleMessages[lastAssistantIndex]?.text)
    : null;
  const controlsBeforeIndex = completedThinking || detailConfig ? lastAssistantIndex : -1;
  let thinkingRendered = false;
  let answerDetailRendered = false;

  for (const [index, message] of visibleMessages.entries()) {
    if (index === controlsBeforeIndex) {
      if (completedThinking) {
        appendThinkingPanel();
        thinkingRendered = true;
      }
      if (detailConfig) {
        appendAnswerDetail(detailConfig);
        answerDetailRendered = true;
      }
    }

    appendMessage(message.role, message.text, {
      streaming: Boolean(message.streaming),
    });
  }

  if (thinkingVisible && !thinkingRendered) {
    appendThinkingPanel();
  }

  if (hasPendingPermissions()) {
    appendPermissionPanel();
  }

  if (detailConfig && !answerDetailRendered) {
    appendAnswerDetail(detailConfig);
  }

  if (streamingAssistant) {
    appendMessage(streamingAssistant.role, streamingAssistant.text, {
      streaming: true,
    });
  }

  if (state.streamError) {
    appendMessage("error", state.streamError);
  } else if (isPromptPending() && !state.streamingAssistant?.text && !thinkingVisible) {
    appendMessage("assistant", getPendingLabel(state.messages), {
      pending: true,
    });
  }

  if (shouldStickToBottom) {
    scrollMessagesToBottom();
  } else {
    updateJumpLatestButton();
  }
  syncThinkingScroll();
}

export function collectVisibleMessages(messages) {
  const visible = [];

  for (const message of messages || []) {
    const role = message.info?.role || "assistant";
    const text = extractMessageText(message);
    if (!text) continue;

    if (role === "assistant" && message.info?.finish === "tool-calls") {
      continue;
    }

    const previous = visible[visible.length - 1];
    if (previous?.role === role) {
      previous.text = `${previous.text}\n\n${text}`;
    } else {
      visible.push({ role, text });
    }
  }

  return visible;
}

function addOptimisticMessages(visibleMessages) {
  for (const message of state.optimisticMessages) {
    if (message.sessionID !== state.currentSessionID) continue;
    const alreadyRendered = visibleMessages.some(
      (item) => item.role === message.role && item.text === message.text
    );
    if (!alreadyRendered) visibleMessages.push({ role: message.role, text: message.text });
  }
}

function getStreamingAssistant(visibleMessages) {
  const streaming = state.streamingAssistant;
  if (!streaming?.text || streaming.sessionID !== state.currentSessionID) return null;

  const alreadyRendered = visibleMessages.some(
    (item) => item.role === "assistant" && item.text === streaming.text
  );
  if (alreadyRendered) return null;

  return {
    role: "assistant",
    text: streaming.text,
  };
}

export function findLastAssistantIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return index;
  }
  return -1;
}

export function extractMessageText(message) {
  const textParts = (message.parts || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .filter(Boolean);

  if (textParts.length > 0) return textParts.join("\n\n");
  if (message.info?.error) return formatMessageError(message.info.error);
  return "";
}

export function messagesHaveAssistantOutput(messages) {
  return (messages || []).some((message) => {
    if (message.info?.role !== "assistant") return false;
    return Boolean(extractMessageText(message));
  });
}

function formatMessageError(error) {
  if (!error) return "Request failed.";
  if (typeof error === "string") return error;
  if (error.data?.message) return error.data.message;
  if (error.message) return error.message;
  return JSON.stringify(error, null, 2);
}

export function showEmpty(text) {
  elements.messages.innerHTML = "";
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = text;
  elements.messages.append(empty);
  state.messagesPinnedToBottom = true;
  updateJumpLatestButton();
}

export function appendMessage(role, text, options = {}) {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  if (options.pending) message.classList.add("pending");
  if (options.streaming) message.classList.add("streaming");

  const label = document.createElement("span");
  label.className = "role";
  label.textContent = role === "user" ? "You" : role === "error" ? "Error" : "Aibase";

  const body = document.createElement("div");
  body.className = "message-body";
  if (options.pending) {
    body.innerHTML = `<span>${escapeHtml(text)}</span><span class="typing-dots"><i></i><i></i><i></i></span>`;
  } else if (role === "assistant") {
    body.innerHTML = renderMarkdown(text);
  } else {
    body.textContent = text;
  }

  message.append(label, body);
  elements.messages.append(message);
}

export function appendLocalMessage(role, text) {
  appendMessage(role, text);
}

export function appendThinkingPanel() {
  if (!state.thinkingActive && !state.thinkingExpanded) {
    const line = document.createElement("button");
    line.className = "thinking-toggle thinking-line";
    line.type = "button";
    line.setAttribute("aria-expanded", "false");
    line.innerHTML = "<span>已完成思考</span><span aria-hidden=\"true\">&gt;</span>";
    elements.messages.append(line);
    return;
  }

  const message = document.createElement("article");
  message.className = `message assistant thinking-message${state.thinkingExpanded ? " expanded" : ""}${state.thinkingActive ? "" : " completed"}`;

  const label = document.createElement("span");
  label.className = "role";
  label.textContent = "Aibase";

  const body = document.createElement("div");
  body.className = "message-body";

  const toggle = document.createElement("button");
  toggle.className = "thinking-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", String(state.thinkingExpanded));
  toggle.innerHTML = `
    <span class="thinking-title">
      <span class="thinking-pulse" aria-hidden="true"></span>
      <strong>${state.thinkingActive ? "思考过程" : "已完成思考"}</strong>
      <em>${escapeHtml(state.thinkingActive ? state.thinkingStatus || getPendingLabel(state.messages) : "查看详情")}</em>
    </span>
    <span class="thinking-meta">${state.thinkingExpanded ? "收起" : ">"}</span>
  `;

  const log = document.createElement("div");
  log.className = "thinking-log";

  for (const entry of state.thinkingEntries) {
    const item = document.createElement("div");
    item.className = `thinking-entry ${entry.kind || "status"}`;
    item.innerHTML = `<span>${escapeHtml(formatShortTime(entry.time))}</span><p>${escapeHtml(entry.label)}</p>${entry.detail ? `<pre>${escapeHtml(entry.detail)}</pre>` : ""}`;
    log.append(item);
  }

  body.append(toggle, log);
  message.append(label, body);
  elements.messages.append(message);
}

export function appendPermissionPanel() {
  for (const permission of state.pendingPermissions) {
    const message = document.createElement("article");
    message.className = "message permission-request";
    message.setAttribute("data-permission-id", permission.id);

    const label = document.createElement("span");
    label.className = "role";
    label.textContent = "授权请求";

    const body = document.createElement("div");
    body.className = "message-body";

    const info = document.createElement("div");
    info.className = "permission-info";
    const rawPattern = permission.pattern;
    const patterns = Array.isArray(rawPattern) ? rawPattern : rawPattern ? [rawPattern] : [];
    info.innerHTML = `
      <strong>${escapeHtml(permission.title || "需要授权才能继续")}</strong>
      ${permission.type ? `<span class="permission-type">${escapeHtml(permission.type)}</span>` : ""}
      ${patterns.length ? `<span class="permission-pattern">${escapeHtml(patterns.join("、"))}</span>` : ""}
    `;

    const actions = document.createElement("div");
    actions.className = "permission-actions";

    const onceBtn = document.createElement("button");
    onceBtn.type = "button";
    onceBtn.className = "permission-btn once";
    onceBtn.textContent = "允许一次";
    onceBtn.addEventListener("click", () => respondToPermission(permission.id, "once"));

    const alwaysBtn = document.createElement("button");
    alwaysBtn.type = "button";
    alwaysBtn.className = "permission-btn always";
    alwaysBtn.textContent = "总是允许";
    alwaysBtn.addEventListener("click", () => respondToPermission(permission.id, "always"));

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "permission-btn reject";
    rejectBtn.textContent = "拒绝";
    rejectBtn.addEventListener("click", () => respondToPermission(permission.id, "reject"));

    actions.append(onceBtn, alwaysBtn, rejectBtn);
    body.append(info, actions);
    message.append(label, body);
    elements.messages.append(message);
  }
}

export function appendAnswerDetail(detailConfig) {
  if (!detailConfig.expanded) {
    const line = document.createElement("button");
    line.className = "answer-detail-toggle answer-detail-line";
    line.type = "button";
    line.dataset.detailKey = detailConfig.key;
    line.setAttribute("aria-expanded", "false");
    line.innerHTML = "<span>详情</span><span aria-hidden=\"true\">&gt;</span>";
    elements.messages.append(line);
    return;
  }

  const detail = document.createElement("section");
  detail.className = "answer-detail-panel";

  const toggle = document.createElement("button");
  toggle.className = "answer-detail-toggle";
  toggle.type = "button";
  toggle.dataset.detailKey = detailConfig.key;
  toggle.setAttribute("aria-expanded", "true");
  toggle.innerHTML = "<span>详情</span><span aria-hidden=\"true\">收起</span>";

  const body = document.createElement("div");
  body.className = "message-body answer-detail-body";
  body.innerHTML = renderMarkdown(detailConfig.text);

  detail.append(toggle, body);
  elements.messages.append(detail);
}

export async function respondToPermission(permissionID, response) {
  const sessionID = state.currentSessionID;
  if (!sessionID) return;
  try {
    await requestJson(
      `/api/sessions/${encodeURIComponent(sessionID)}/permissions/${encodeURIComponent(permissionID)}`,
      { method: "POST", body: { response } }
    );
    removePermission(permissionID);
    renderMessages(state.messages || []);
  } catch (error) {
    addThinkingEntry({
      kind: "error",
      label: "授权响应失败",
      detail: error instanceof Error ? error.message : String(error),
    });
    renderMessages(state.messages || []);
  }
}

export function hasScrollableMessages() {
  return elements.messages.scrollHeight > elements.messages.clientHeight + 2;
}

export function isMessagesAtBottom() {
  const distance =
    elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight;
  return distance < 24;
}

export function scrollMessagesToBottom(behavior = "auto") {
  elements.messages.scrollTo({
    top: elements.messages.scrollHeight,
    behavior,
  });
  state.messagesPinnedToBottom = true;
  updateJumpLatestButton();
}

export function updateJumpLatestButton() {
  const shouldShow = hasScrollableMessages() && !state.messagesPinnedToBottom;
  elements.jumpLatest.hidden = !shouldShow;
}

export function syncThinkingScroll() {
  const log = elements.messages.querySelector(".thinking-log");
  if (log) log.scrollTop = log.scrollHeight;
}

export async function streamPrompt(sessionID, text, model) {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionID)}/prompt/stream`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, model }),
    }
  );

  if (!response.ok) {
    const payload = await response.text().then((t) => (t ? JSON.parse(t) : null));
    throw new Error(payload?.message || payload?.error || response.statusText);
  }

  if (!response.body) {
    throw new Error("Streaming response is not available in this browser.");
  }

  await readSseStream(response.body, async (event, payload) => {
    if (sessionID !== state.currentSessionID) return;

    if (event === "phase") {
      state.streamPhase = payload.label || state.streamPhase;
      addThinkingEntry({ kind: "status", label: state.streamPhase });
      renderMessages(state.messages || []);
      return;
    }

    if (event === "trace") {
      addThinkingEntry(payload);
      renderMessages(state.messages || []);
      return;
    }

    if (event === "assistant") {
      rememberAnswerDetail(sessionID, payload.text || "");
      state.streamingAssistant = { sessionID, text: payload.text || "" };
      state.streamError = "";
      renderMessages(state.messages || []);
      return;
    }

    if (event === "messages") {
      const messages = payload.messages || [];
      rememberAnswerDetailsFromMessages(sessionID, messages, text);
      storeAnswerDetailForMessages(sessionID, messages, text);
      if (messagesHaveAssistantOutput(messages)) {
        state.streamError = "";
      }
      renderMessages(messages);
      return;
    }

    if (event === "error") {
      state.pendingPermissions = [];
      state.streamError = payload.message || "Request failed.";
      addThinkingEntry({
        kind: "error",
        label: "请求出错",
        detail: state.streamError,
      });
      finishThinking("请求出错");
      renderMessages(state.messages || []);
      return;
    }

    if (event === "permission") {
      if (sessionID !== state.currentSessionID) return;
      addPermission(payload);
      renderMessages(state.messages || []);
      return;
    }

    if (event === "done") {
      state.pendingPermissions = [];
      finishThinking("已完成");
      storeAnswerDetailForMessages(sessionID, state.messages || [], text);
      renderMessages(state.messages || []);
    }
  });
}
