import { elements } from "./elements.js";

const state = {
  currentSessionID: null,
  sessions: [],
  messages: [],
  skills: [],
  mcpDocs: [],
  models: [],
  selectedModel: "",
  modelQuery: "",
  modelPickerOpen: false,
  busy: false,
  optimisticMessages: [],
  pendingSessionID: null,
  streamingAssistant: null,
  streamError: "",
  streamPhase: "",
  messagesPinnedToBottom: true,
  archivingSessionID: null,
  thinkingSessionID: null,
  thinkingEntries: [],
  thinkingExpanded: false,
  thinkingActive: false,
  thinkingStatus: "",
  pendingPermissions: [],
  answerDetailSessionID: null,
  answerDetailText: "",
  answerDetailExpandedKeys: new Set(),
  answerDetails: Object.create(null),
  runtimeRestarting: false,
  agents: [],
  agentModalOpen: false,
  editingAgent: null,
  knowledgeTree: { folders: [], files: [] },
  knowledgeRoot: "",
  referencedKnowledge: [],
  knowledgeModalOpen: false,
  knowledgeModalMode: "create",
  editingKnowledge: null,
  marketplaceBundles: [],
  repos: [],
  repoModalOpen: false,
};

export { state };

let renderModelPickerImpl = () => {};

export function initBusyBridge(renderModelPicker) {
  renderModelPickerImpl = renderModelPicker;
}

export function setBusy(value, label = "") {
  state.busy = value;
  elements.send.disabled = value;
  elements.newSession.disabled = value;
  elements.refresh.disabled = value;
  elements.restartRuntime.disabled = value || state.runtimeRestarting;
  elements.sendState.textContent = label;
  renderModelPickerImpl();
}

export function syncRuntimeRestartButton() {
  elements.restartRuntime.disabled = state.busy || state.runtimeRestarting;
  elements.restartRuntime.textContent = state.runtimeRestarting ? "Restarting..." : "Restart Runtime";
}

export function setKernelStatus(text, stateName) {
  elements.kernelStatus.textContent = text;
  elements.factStatus.textContent = text;
  elements.kernelDot.className = `dot ${stateName || ""}`.trim();
}

export function setSkillUploadState(text, isError = false) {
  elements.skillUploadState.textContent = text || "同名覆盖";
  elements.skillDropzone.classList.toggle("is-error", Boolean(isError));
}

export function setMcpUploadState(text, isError = false) {
  elements.mcpUploadState.textContent = text || "同名覆盖";
  elements.mcpDropzone.classList.toggle("is-error", Boolean(isError));
}

export function isPromptPending() {
  return Boolean(
    state.busy && state.pendingSessionID && state.pendingSessionID === state.currentSessionID
  );
}

export function getPendingLabel(messages) {
  if (state.streamPhase) return state.streamPhase;
  const latestAssistant = [...(messages || [])]
    .reverse()
    .find((message) => message.info?.role === "assistant");
  const hasTool = latestAssistant?.parts?.some((part) => part.type === "tool");
  const hasText = latestAssistant?.parts?.some((part) => part.type === "text");
  if (hasTool) return "正在调用工具";
  if (hasText) return "正在整理结果";
  return "正在分析";
}

export function resetThinking(sessionID, label) {
  state.thinkingSessionID = sessionID;
  state.thinkingEntries = [];
  state.pendingPermissions = [];
  state.thinkingExpanded = false;
  state.thinkingActive = true;
  state.thinkingStatus = label || "正在分析";
  addThinkingEntry({ kind: "status", label: state.thinkingStatus });
}

export function addThinkingEntry(entry = {}) {
  if (!state.thinkingSessionID || state.thinkingSessionID !== state.currentSessionID) return;
  const label = String(entry.label || entry.title || state.streamPhase || "正在处理").trim();
  const detail = String(entry.detail || entry.message || "").trim();
  const kind = String(entry.kind || "status").trim();
  if (!label && !detail) return;
  const last = state.thinkingEntries[state.thinkingEntries.length - 1];
  if (last?.label === label && last?.detail === detail && last?.kind === kind) {
    last.time = entry.time || Date.now();
    state.thinkingStatus = label || state.thinkingStatus;
    return;
  }
  state.thinkingEntries.push({ kind, label, detail, time: entry.time || Date.now() });
  state.thinkingEntries = state.thinkingEntries.slice(-80);
  state.thinkingStatus = label || state.thinkingStatus;
}

export function finishThinking(label) {
  if (!state.thinkingSessionID || state.thinkingSessionID !== state.currentSessionID) return;
  state.thinkingActive = false;
  state.thinkingStatus = label || state.thinkingStatus || "已完成";
  addThinkingEntry({
    kind: label?.includes("失败") || label?.includes("出错") ? "error" : "done",
    label: state.thinkingStatus,
  });
}

export function shouldRenderThinking() {
  return state.thinkingSessionID === state.currentSessionID && state.thinkingEntries.length > 0;
}

export function addPermission(permission) {
  if (!permission?.id) return;
  if (state.pendingPermissions.some((item) => item.id === permission.id)) return;
  state.pendingPermissions.push(permission);
  state.pendingPermissions = state.pendingPermissions.slice(-10);
}

export function removePermission(permissionID) {
  state.pendingPermissions = state.pendingPermissions.filter((item) => item.id !== permissionID);
}

export function hasPendingPermissions() {
  return state.pendingPermissions.length > 0 && state.thinkingSessionID === state.currentSessionID;
}

export function resetAnswerDetail(sessionID) {
  state.answerDetailSessionID = sessionID;
  state.answerDetailText = "";
}

export function rememberAnswerDetail(sessionID, text) {
  if (!sessionID || sessionID !== state.currentSessionID) return;
  const candidate = String(text || "").trim();
  if (!candidate) return;
  if (candidate.length <= String(state.answerDetailText || "").trim().length) return;
  state.answerDetailSessionID = sessionID;
  state.answerDetailText = candidate;
}

function collectMessagesForDetail(messages) {
  const visible = [];
  for (const message of messages || []) {
    const role = message.info?.role || "assistant";
    const text = (message.parts || [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .filter(Boolean)
      .join("\n\n");
    if (!text) continue;
    if (role === "assistant" && message.info?.finish === "tool-calls") continue;
    const previous = visible[visible.length - 1];
    if (previous?.role === role) {
      previous.text = `${previous.text}\n\n${text}`;
    } else {
      visible.push({ role, text });
    }
  }
  return visible;
}

function findLastAssistantIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") return i;
  }
  return -1;
}

export function rememberAnswerDetailsFromMessages(sessionID, messages, promptText = "") {
  const visibleMessages = collectMessagesForDetail(messages);
  const answerIndex = findAnswerIndexForPrompt(visibleMessages, promptText);
  if (answerIndex >= 0) rememberAnswerDetail(sessionID, visibleMessages[answerIndex].text);
}

export function storeAnswerDetailForMessages(sessionID, messages, promptText = "") {
  if (!sessionID || sessionID !== state.currentSessionID) return;
  const visibleMessages = collectMessagesForDetail(messages);
  const answerIndex = findAnswerIndexForPrompt(visibleMessages, promptText);
  if (answerIndex < 0) return;
  const finalText = visibleMessages[answerIndex]?.text || "";
  const detailText = getUsefulAnswerDetailText(finalText, state.answerDetailText);
  if (!detailText) return;
  state.answerDetails[getAnswerDetailKey(sessionID, answerIndex, finalText)] = detailText;
}

export function findAnswerIndexForPrompt(visibleMessages, promptText = "") {
  if (!promptText) return findLastAssistantIndex(visibleMessages);
  const prompt = normalizeAnswerText(promptText);
  let promptIndex = -1;
  for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
    if (visibleMessages[i]?.role !== "user") continue;
    const userText = normalizeAnswerText(visibleMessages[i].text);
    if (userText === prompt || userText.endsWith(prompt) || prompt.endsWith(userText)) {
      promptIndex = i;
      break;
    }
  }
  if (promptIndex < 0) return -1;
  for (let i = visibleMessages.length - 1; i > promptIndex; i -= 1) {
    if (visibleMessages[i]?.role === "assistant") return i;
  }
  return -1;
}

export function getAnswerDetailConfig(messageIndex, finalText) {
  if (messageIndex < 0 || !finalText) return null;
  const detailKey = getAnswerDetailKey(state.currentSessionID, messageIndex, finalText);
  const storedDetail = state.answerDetails[detailKey];
  const draftDetail =
    state.answerDetailSessionID === state.currentSessionID
      ? getUsefulAnswerDetailText(finalText, state.answerDetailText)
      : "";
  const detailText = storedDetail || draftDetail;
  if (!detailText) return null;
  return { key: detailKey, text: detailText, expanded: state.answerDetailExpandedKeys.has(detailKey) };
}

export function getUsefulAnswerDetailText(finalText, detailText) {
  const detail = String(detailText || "").trim();
  const finalAnswer = String(finalText || "").trim();
  if (!detail || !finalAnswer) return "";
  const nd = normalizeAnswerText(detail);
  const nf = normalizeAnswerText(finalAnswer);
  if (!nd || !nf || nd === nf || nf.includes(nd)) return "";
  const minExtra = Math.max(48, Math.round(nf.length * 0.25));
  if (nd.length <= nf.length + minExtra) return "";
  return detail;
}

export function normalizeAnswerText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function getAnswerDetailKey(sessionID, messageIndex, finalText) {
  return `${sessionID || "session"}:${messageIndex}:${hashText(finalText)}`;
}

function hashText(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
