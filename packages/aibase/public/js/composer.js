import {
  state,
  setBusy,
  resetThinking,
  addThinkingEntry,
  finishThinking,
  rememberAnswerDetail,
  rememberAnswerDetailsFromMessages,
  storeAnswerDetailForMessages,
  resetAnswerDetail,
} from "./state.js";
import { elements } from "./elements.js";
import { extractModelsFromProviders } from "/model-options.js";
import { requestJson, loadSessions } from "./api.js";
import { renderMessages, loadAndShowMessages, streamPrompt } from "./chat.js";
import { autoTitleSession, createSession, renderSessions } from "./sessions.js";
import { renderKnowledgeReferences, renderModelPicker } from "./panels.js";

export async function sendPrompt() {
  const text = elements.prompt.value.trim();
  if (!text || state.busy) return;

  if (!state.currentSessionID) {
    await createSession();
  }

  if (!state.currentSessionID) return;

  elements.prompt.value = "";
  const sessionID = state.currentSessionID;
  const model = state.selectedModel || undefined;
  const { prependKnowledgeReferences } = await import("./panels.js");
  const finalText = prependKnowledgeReferences(text, state.referencedKnowledge);
  state.optimisticMessages = [
    {
      role: "user",
      text,
      sessionID,
    },
  ];
  state.pendingSessionID = sessionID;
  state.streamingAssistant = null;
  state.streamError = "";
  state.streamPhase = "正在分析";
  storeAnswerDetailForMessages(sessionID, state.messages || []);
  resetAnswerDetail(sessionID);
  resetThinking(sessionID, "准备发送请求");
  renderMessages(state.messages || []);
  setBusy(true, "Generating");

  try {
    await autoTitleSession(sessionID, text);
    await streamPrompt(sessionID, finalText, model);
    await loadSessions();
    renderSessions();
    await loadAndShowMessages();
    state.referencedKnowledge = [];
    renderKnowledgeReferences();
  } catch (error) {
    state.streamError = error.message;
    finishThinking(`请求失败：${error.message}`);
    renderMessages(state.messages || []);
  } finally {
    state.optimisticMessages = [];
    state.pendingSessionID = null;
    state.streamingAssistant = null;
    state.streamPhase = "";
    setBusy(false);
    renderMessages(state.messages || []);
  }
}

export async function loadModels() {
  try {
    const payload = await requestJson("/api/opencode/provider");
    state.models = extractModelsFromProviders(payload);
    const defaultModel =
      state.models.find((item) => item.default)?.id || state.models[0]?.id || "";
    if (!state.selectedModel || !state.models.some((item) => item.id === state.selectedModel)) {
      state.selectedModel = defaultModel;
    }
    renderModelPicker();
  } catch {
    state.models = [];
    state.selectedModel = "";
    state.modelQuery = "";
    state.modelPickerOpen = false;
    renderModelPicker();
  }
}
