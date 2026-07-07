import { extractModelsFromProviders } from "/model-options.js";

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

const defaultSessionTitles = new Set([
  "",
  "Aibase session",
  "New session",
  "Untitled",
]);

const elements = {
  workspace: document.querySelector("#workspace"),
  kernelDot: document.querySelector("#kernel-dot"),
  kernelStatus: document.querySelector("#kernel-status"),
  factStatus: document.querySelector("#fact-status"),
  factSkills: document.querySelector("#fact-skills"),
  factMcp: document.querySelector("#fact-mcp"),
  factEnvUrl: document.querySelector("#fact-env-url"),
  sessions: document.querySelector("#sessions"),
  messages: document.querySelector("#messages"),
  skills: document.querySelector("#skills"),
  skillCount: document.querySelector("#skill-count"),
  skillDropzone: document.querySelector("#skill-dropzone"),
  skillFile: document.querySelector("#skill-file"),
  skillUploadState: document.querySelector("#skill-upload-state"),
  mcpDocs: document.querySelector("#mcp-docs"),
  mcpCount: document.querySelector("#mcp-count"),
  mcpDropzone: document.querySelector("#mcp-dropzone"),
  mcpFile: document.querySelector("#mcp-file"),
  mcpUploadState: document.querySelector("#mcp-upload-state"),
  sessionTitle: document.querySelector("#session-title"),
  prompt: document.querySelector("#prompt"),
  send: document.querySelector("#send"),
  modelPicker: document.querySelector("#model-picker"),
  modelToggle: document.querySelector("#model-toggle"),
  modelMenu: document.querySelector("#model-menu"),
  modelSearch: document.querySelector("#model-search"),
  modelOptions: document.querySelector("#model-options"),
  sendState: document.querySelector("#send-state"),
  jumpLatest: document.querySelector("#jump-latest"),
  composer: document.querySelector("#composer"),
  newSession: document.querySelector("#new-session"),
  refresh: document.querySelector("#refresh"),
  restartRuntime: document.querySelector("#restart-runtime"),
  agents: document.querySelector("#agents"),
  agentCount: document.querySelector("#agent-count"),
  newAgent: document.querySelector("#new-agent"),
  agentModal: document.querySelector("#agent-modal"),
  agentForm: document.querySelector("#agent-form"),
  agentModalTitle: document.querySelector("#agent-modal-title"),
  agentName: document.querySelector("#agent-name"),
  agentDisplayName: document.querySelector("#agent-display-name"),
  agentMode: document.querySelector("#agent-mode"),
  agentDescription: document.querySelector("#agent-description"),
  agentPrompt: document.querySelector("#agent-prompt"),
  agentModel: document.querySelector("#agent-model"),
  agentEnabled: document.querySelector("#agent-enabled"),
  agentModalCancel: document.querySelector("#agent-modal-cancel"),
  factAgents: document.querySelector("#fact-agents"),
  factKnowledge: document.querySelector("#fact-knowledge"),
  knowledgeCount: document.querySelector("#knowledge-count"),
  knowledgeRoot: document.querySelector("#knowledge-root"),
  knowledgeTree: document.querySelector("#knowledge-tree"),
  newKnowledgeFolder: document.querySelector("#new-knowledge-folder"),
  newKnowledgeFile: document.querySelector("#new-knowledge-file"),
  knowledgeReferences: document.querySelector("#knowledge-references"),
  knowledgeReferenceTags: document.querySelector("#knowledge-reference-tags"),
  clearKnowledgeReferences: document.querySelector("#clear-knowledge-references"),
  knowledgeModal: document.querySelector("#knowledge-modal"),
  knowledgeForm: document.querySelector("#knowledge-form"),
  knowledgeModalTitle: document.querySelector("#knowledge-modal-title"),
  knowledgeKind: document.querySelector("#knowledge-kind"),
  knowledgeParent: document.querySelector("#knowledge-parent"),
  knowledgeName: document.querySelector("#knowledge-name"),
  knowledgeContentWrap: document.querySelector("#knowledge-content-wrap"),
  knowledgeContent: document.querySelector("#knowledge-content"),
  knowledgeModalCancel: document.querySelector("#knowledge-modal-cancel"),
  marketplaceList: document.querySelector("#marketplace-list"),
  uploadSkills: document.querySelector("#upload-skills"),
  uploadMcp: document.querySelector("#upload-mcp"),
  uploadAgents: document.querySelector("#upload-agents"),
  uploadKnowledge: document.querySelector("#upload-knowledge"),
  marketplaceUploadFile: document.querySelector("#marketplace-upload-file"),
  marketplaceArchive: document.querySelector("#marketplace-archive"),
  repos: document.querySelector("#repos"),
  repoCount: document.querySelector("#repo-count"),
  newRepo: document.querySelector("#new-repo"),
  repoModal: document.querySelector("#repo-modal"),
  repoForm: document.querySelector("#repo-form"),
  repoUrl: document.querySelector("#repo-url"),
  repoBranch: document.querySelector("#repo-branch"),
  repoDepth: document.querySelector("#repo-depth"),
  repoUsername: document.querySelector("#repo-username"),
  repoEmail: document.querySelector("#repo-email"),
  repoPassword: document.querySelector("#repo-password"),
  repoToken: document.querySelector("#repo-token"),
  repoSshKey: document.querySelector("#repo-ssh-key"),
  repoModalCancel: document.querySelector("#repo-modal-cancel"),
};

elements.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendPrompt();
});

elements.newSession.addEventListener("click", async () => {
  await createSession();
});

elements.refresh.addEventListener("click", async () => {
  await refreshAll();
});

elements.restartRuntime.addEventListener("click", async () => {
  await restartRuntime();
});

elements.newKnowledgeFolder.addEventListener("click", () => {
  openKnowledgeModal({ kind: "folder" });
});

elements.newKnowledgeFile.addEventListener("click", () => {
  openKnowledgeModal({ kind: "file" });
});

elements.clearKnowledgeReferences.addEventListener("click", () => {
  state.referencedKnowledge = [];
  renderKnowledgeReferences();
});

elements.knowledgeModalCancel.addEventListener("click", () => {
  closeKnowledgeModal();
});

elements.knowledgeKind.addEventListener("change", () => {
  syncKnowledgeModalFields();
});

elements.knowledgeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveKnowledgeEntry();
});

elements.knowledgeModal.addEventListener("click", (event) => {
  if (event.target === elements.knowledgeModal) {
    closeKnowledgeModal();
  }
});

elements.newRepo.addEventListener("click", () => {
  openRepoModal();
});

elements.repoModalCancel.addEventListener("click", () => {
  closeRepoModal();
});

elements.repoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveRepo();
});

elements.repoModal.addEventListener("click", (event) => {
  if (event.target === elements.repoModal) {
    closeRepoModal();
  }
});

elements.newAgent.addEventListener("click", () => {
  openAgentModal();
});

elements.agentModalCancel.addEventListener("click", () => {
  closeAgentModal();
});

elements.agentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveAgent();
});

elements.agentModal.addEventListener("click", (event) => {
  if (event.target === elements.agentModal) {
    closeAgentModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.agentModalOpen) {
    closeAgentModal();
  }
  if (event.key === "Escape" && state.knowledgeModalOpen) {
    closeKnowledgeModal();
  }
  if (event.key === "Escape" && state.repoModalOpen) {
    closeRepoModal();
  }
});

elements.modelToggle.addEventListener("click", () => {
  if (state.busy) return;
  state.modelPickerOpen = !state.modelPickerOpen;
  renderModelPicker();
  if (state.modelPickerOpen) {
    elements.modelSearch.focus();
    elements.modelSearch.select();
  }
});

elements.modelSearch.addEventListener("input", () => {
  state.modelQuery = elements.modelSearch.value || "";
  renderModelOptions();
});

document.addEventListener("click", (event) => {
  if (!state.modelPickerOpen) return;
  if (elements.modelPicker.contains(event.target)) return;
  state.modelPickerOpen = false;
  renderModelPicker();
});

elements.skillDropzone.addEventListener("click", () => {
  elements.skillFile.click();
});

elements.mcpDropzone.addEventListener("click", () => {
  elements.mcpFile.click();
});

elements.skillDropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.skillFile.click();
  }
});

elements.mcpDropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.mcpFile.click();
  }
});

elements.skillFile.addEventListener("change", async () => {
  const [file] = elements.skillFile.files;
  elements.skillFile.value = "";
  if (file) await uploadSkillZip(file);
});

elements.mcpFile.addEventListener("change", async () => {
  const [file] = elements.mcpFile.files;
  elements.mcpFile.value = "";
  if (file) await uploadMcpDocument(file);
});

bindDropzone(elements.skillDropzone, uploadSkillZip);
bindDropzone(elements.mcpDropzone, uploadMcpDocument);

elements.skillDropzone.addEventListener("drop", async (event) => {
  const [file] = event.dataTransfer.files;
  if (file) await uploadSkillZip(file);
});

elements.mcpDropzone.addEventListener("drop", async (event) => {
  const [file] = event.dataTransfer.files;
  if (file) await uploadMcpDocument(file);
});

elements.prompt.addEventListener("keydown", async (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    await sendPrompt();
  }
});

elements.messages.addEventListener("scroll", () => {
  state.messagesPinnedToBottom = isMessagesAtBottom();
  updateJumpLatestButton();
});

elements.messages.addEventListener("click", (event) => {
  const answerDetailToggle = event.target.closest(".answer-detail-toggle");
  if (answerDetailToggle) {
    const detailKey = answerDetailToggle.dataset.detailKey;
    if (detailKey) {
      if (state.answerDetailExpandedKeys.has(detailKey)) {
        state.answerDetailExpandedKeys.delete(detailKey);
      } else {
        state.answerDetailExpandedKeys.add(detailKey);
      }
    }
    renderMessages(state.messages || []);
    return;
  }

  const toggle = event.target.closest(".thinking-toggle");
  if (!toggle) return;

  state.thinkingExpanded = !state.thinkingExpanded;
  renderMessages(state.messages || []);
});

elements.jumpLatest.addEventListener("click", () => {
  scrollMessagesToBottom("smooth");
});

await refreshAll();

async function refreshAll() {
  await Promise.all([
    loadHealth(),
    loadModels(),
    loadSkills(),
    loadMcpDocuments(),
    loadAgents(),
    loadKnowledge(),
    loadRepos(),
    loadSessions(),
    loadMarketplace(),
  ]);

  if (state.currentSessionID && !state.sessions.some((session) => session.id === state.currentSessionID)) {
    state.currentSessionID = null;
  }

  if (!state.currentSessionID && state.sessions.length > 0) {
    state.currentSessionID = state.sessions[0].id;
  }

  renderSessions();
  await loadMessages();
}

async function loadModels() {
  try {
    const payload = await requestJson("/api/opencode/provider");
    state.models = extractModelsFromProviders(payload);
    const defaultModel = state.models.find((item) => item.default)?.id || state.models[0]?.id || "";
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

async function loadHealth() {
  try {
    const health = await requestJson("/api/health");
    elements.workspace.textContent = health.workspace;
    elements.factSkills.textContent = health.skillsRoot;
    elements.factMcp.textContent = health.mcpRoot || "-";
    elements.factAgents.textContent = health.agentsRoot || "-";
    elements.factKnowledge.textContent = health.knowledgeRoot || "-";
    elements.factEnvUrl.textContent = health.environmentBaseURL || "未配置";
    const statusText = state.runtimeRestarting ? "Restarting" : "Ready";
    const statusName = state.runtimeRestarting ? "warn" : "ok";
    setKernelStatus(statusText, statusName);
  } catch (error) {
    setKernelStatus(error.message, "error");
  }
}

async function restartRuntime() {
  if (state.runtimeRestarting || state.busy) return;

  state.runtimeRestarting = true;
  syncRuntimeRestartButton();
  setKernelStatus("Restarting", "warn");

  try {
    await requestJson("/api/runtime/restart", {
      method: "POST",
    });
    await refreshAll();
    setKernelStatus("Ready", "ok");
  } catch (error) {
    setKernelStatus(error.message, "error");
  } finally {
    state.runtimeRestarting = false;
    syncRuntimeRestartButton();
  }
}

async function loadSkills() {
  try {
    const payload = await requestJson("/api/skills");
    state.skills = payload.skills || [];
    renderSkills();
  } catch (error) {
    state.skills = [];
    renderSkills(error.message);
  }
}

async function loadMcpDocuments() {
  try {
    const payload = await requestJson("/api/mcp");
    state.mcpDocs = payload.documents || [];
    elements.factEnvUrl.textContent = payload.environmentBaseURL || "未配置";
    renderMcpDocuments();
  } catch (error) {
    state.mcpDocs = [];
    renderMcpDocuments(error.message);
  }
}

async function loadKnowledge() {
  try {
    const payload = await requestJson("/api/knowledge");
    state.knowledgeTree = payload.tree || { folders: [], files: [] };
    state.knowledgeRoot = payload.root || "";
    renderKnowledge();
  } catch (error) {
    state.knowledgeTree = { folders: [], files: [] };
    state.knowledgeRoot = "";
    renderKnowledge(error.message);
  }
}

async function uploadSkillZip(file) {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    setSkillUploadState("仅支持 ZIP", true);
    return;
  }

  setSkillUploadState("导入中");
  try {
    const payload = await requestJson("/api/skills/upload", {
      method: "POST",
      rawBody: file,
      headers: {
        "content-type": "application/zip",
        "x-file-name": encodeURIComponent(file.name),
      },
    });
    state.skills = payload.skills || [];
    renderSkills();
    const action = payload.overwritten ? "已更新" : "已导入";
    setSkillUploadState(`${action} ${payload.name}`);
  } catch (error) {
    setSkillUploadState(error.message, true);
  }
}

async function uploadMcpDocument(file) {
  if (!/\.(md|markdown)$/i.test(file.name)) {
    setMcpUploadState("仅支持 Markdown", true);
    return;
  }

  setMcpUploadState("导入中");
  try {
    const payload = await requestJson("/api/mcp/upload", {
      method: "POST",
      rawBody: file,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "x-file-name": encodeURIComponent(file.name),
      },
    });
    state.mcpDocs = payload.documents || [];
    renderMcpDocuments();
    const action = payload.overwritten ? "已更新" : "已导入";
    setMcpUploadState(`${action} ${payload.displayName || payload.name}`);
  } catch (error) {
    setMcpUploadState(error.message, true);
  }
}

function bindDropzone(dropzone) {
  for (const eventName of ["dragenter", "dragover"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    });
  }
}

async function loadSessions() {
  try {
    state.sessions = await requestJson("/api/sessions");
  } catch (error) {
    state.sessions = [];
    showEmpty(`Session loading failed: ${error.message}`);
  }
}

async function createSession() {
  setBusy(true, "Creating session");
  try {
    const session = await requestJson("/api/sessions", {
      method: "POST",
      body: { title: "Aibase session" },
    });
    state.currentSessionID = session.id;
    state.messagesPinnedToBottom = true;
    await loadSessions();
    renderSessions();
    await loadMessages();
  } catch (error) {
    showEmpty(`Session creation failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function loadMessages() {
  if (!state.currentSessionID) {
    elements.sessionTitle.textContent = "Aibase Console";
    showEmpty("Create a session to begin.");
    return;
  }

  const session = state.sessions.find((item) => item.id === state.currentSessionID);
  elements.sessionTitle.textContent = session?.title || "Aibase session";

  try {
    const messages = await requestJson(`/api/sessions/${encodeURIComponent(state.currentSessionID)}/messages`);
    renderMessages(messages);
  } catch (error) {
    showEmpty(`Message loading failed: ${error.message}`);
  }
}

async function sendPrompt() {
  const text = elements.prompt.value.trim();
  if (!text || state.busy) return;

  if (!state.currentSessionID) {
    await createSession();
  }

  if (!state.currentSessionID) return;

  elements.prompt.value = "";
  const sessionID = state.currentSessionID;
  const model = state.selectedModel || undefined;
  const finalText = prependKnowledgeReferences(text, state.referencedKnowledge);
  state.optimisticMessages = [{
    role: "user",
    text,
    sessionID,
  }];
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
    await loadMessages();
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

async function autoTitleSession(sessionID, text) {
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

function isDefaultSessionTitle(title) {
  return defaultSessionTitles.has(String(title || "").trim());
}

function applySessionTitle(sessionID, title) {
  const session = state.sessions.find((item) => item.id === sessionID);
  if (session) {
    session.title = title;
    session.time = {
      ...(session.time || {}),
      updated: Date.now(),
    };
  }

  if (sessionID === state.currentSessionID) {
    elements.sessionTitle.textContent = title;
  }

  renderSessions();
}

function summarizeSessionTitle(text) {
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

async function streamPrompt(sessionID, text, model) {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionID)}/prompt/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, model }),
  });

  if (!response.ok) {
    const payload = await readJsonResponse(response);
    throw new Error(payload?.message || payload?.error || response.statusText);
  }

  if (!response.body) {
    throw new Error("Streaming response is not available in this browser.");
  }

  await readSseStream(response.body, async (event, payload) => {
    if (sessionID !== state.currentSessionID) return;

    if (event === "phase") {
      state.streamPhase = payload.label || state.streamPhase;
      addThinkingEntry({
        kind: "status",
        label: state.streamPhase,
      });
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
      state.streamingAssistant = {
        sessionID,
        text: payload.text || "",
      };
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

function renderSessions() {
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
      await loadMessages();
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

async function archiveSession(sessionID) {
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
      await loadMessages();
    } else {
      renderSessions();
    }
  } catch (error) {
    showEmpty(`Session archive failed: ${error.message}`);
  } finally {
    state.archivingSessionID = null;
    renderSessions();
  }
}

function renderSkills(errorMessage) {
  elements.skills.innerHTML = "";
  elements.skillCount.textContent = String(state.skills.length);

  if (errorMessage) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = `<strong>Unavailable</strong><p>${escapeHtml(errorMessage)}</p>`;
    elements.skills.append(item);
    return;
  }

  if (state.skills.length === 0) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = "<strong>No skills</strong><p>Add folders under skills/ with SKILL.md.</p>";
    elements.skills.append(item);
    return;
  }

  for (const skill of state.skills) {
    const item = document.createElement("article");
    item.className = "skill";

    const button = document.createElement("button");
    button.type = "button";
    const title = skill.displayName || skill.name;
    const overview = skill.overview || skill.description || skill.location || "";
    button.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(skill.name)}</span>
      <p>${escapeHtml(overview)}</p>
    `;
    button.addEventListener("click", () => insertSkillPrompt(skill));
    item.append(button);
    elements.skills.append(item);
  }
}

function renderMcpDocuments(errorMessage) {
  elements.mcpDocs.innerHTML = "";
  elements.mcpCount.textContent = String(state.mcpDocs.length);

  if (errorMessage) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = `<strong>Unavailable</strong><p>${escapeHtml(errorMessage)}</p>`;
    elements.mcpDocs.append(item);
    return;
  }

  if (state.mcpDocs.length === 0) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = "<strong>No MCP docs</strong><p>Drop a Markdown OpenAPI document here.</p>";
    elements.mcpDocs.append(item);
    return;
  }

  for (const mcpDocument of state.mcpDocs) {
    const item = document.createElement("article");
    item.className = "skill";
    const tools = (mcpDocument.tools || []).slice(0, 3).map((tool) => tool.name).join(", ");
    const suffix = mcpDocument.tools?.length > 3 ? ` +${mcpDocument.tools.length - 3}` : "";

    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `
      <strong>${escapeHtml(mcpDocument.displayName || mcpDocument.name)}</strong>
      <span>${escapeHtml(`${mcpDocument.apiCount || 0} tools${mcpDocument.environmentBaseURL ? ` · ${mcpDocument.environmentBaseURL}` : ""}`)}</span>
      <p>${escapeHtml(tools ? `${tools}${suffix}` : mcpDocument.description || mcpDocument.fileName)}</p>
    `;
    button.addEventListener("click", () => insertMcpPrompt(mcpDocument));
    item.append(button);
    elements.mcpDocs.append(item);
  }
}

function renderMessages(messages) {
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

function collectVisibleMessages(messages) {
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
    const alreadyRendered = visibleMessages.some((item) => item.role === message.role && item.text === message.text);
    if (!alreadyRendered) visibleMessages.push({ role: message.role, text: message.text });
  }
}

function getStreamingAssistant(visibleMessages) {
  const streaming = state.streamingAssistant;
  if (!streaming?.text || streaming.sessionID !== state.currentSessionID) return null;

  const alreadyRendered = visibleMessages.some((item) => item.role === "assistant" && item.text === streaming.text);
  if (alreadyRendered) return null;

  return {
    role: "assistant",
    text: streaming.text,
  };
}

function findLastAssistantIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return index;
  }
  return -1;
}

function isPromptPending() {
  return Boolean(state.busy && state.pendingSessionID && state.pendingSessionID === state.currentSessionID);
}

function getPendingLabel(messages) {
  if (state.streamPhase) return state.streamPhase;

  const latestAssistant = [...(messages || [])].reverse().find((message) => message.info?.role === "assistant");
  const hasTool = latestAssistant?.parts?.some((part) => part.type === "tool");
  const hasText = latestAssistant?.parts?.some((part) => part.type === "text");
  if (hasTool) return "正在调用工具";
  if (hasText) return "正在整理结果";
  return "正在分析";
}

function extractMessageText(message) {
  const textParts = (message.parts || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .filter(Boolean);

  if (textParts.length > 0) return textParts.join("\n\n");
  if (message.info?.error) return formatMessageError(message.info.error);
  return "";
}

function messagesHaveAssistantOutput(messages) {
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

function insertSkillPrompt(skill) {
  const prefix = `Use the ${skill.name} skill for this request.\n`;
  const current = elements.prompt.value.trimStart();
  elements.prompt.value = current.startsWith(prefix) ? current : prefix + current;
  elements.prompt.focus();
}

function insertMcpPrompt(document) {
  const prefix = `Use the ${document.name} MCP tools when this request needs KingEye OpenAPI data.\n`;
  const current = elements.prompt.value.trimStart();
  elements.prompt.value = current.startsWith(prefix) ? current : prefix + current;
  elements.prompt.focus();
}

async function loadAgents() {
  try {
    const payload = await requestJson("/api/agents");
    state.agents = payload.agents || [];
    renderAgents();
  } catch (error) {
    state.agents = [];
    renderAgents(error.message);
  }
}

function renderAgents(errorMessage) {
  elements.agents.innerHTML = "";
  elements.agentCount.textContent = String(state.agents.length);

  if (errorMessage) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = "<strong>Unavailable</strong><p>" + escapeHtml(errorMessage) + "</p>";
    elements.agents.append(item);
    return;
  }

  if (state.agents.length === 0) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = "<strong>No agents</strong><p>Create a custom agent to get started.</p>";
    elements.agents.append(item);
    return;
  }

  for (const agent of state.agents) {
    const item = document.createElement("article");
    item.className = "agent-item";

    const header = document.createElement("div");
    header.className = "agent-item-header";

    const info = document.createElement("div");
    info.className = "agent-item-info";

    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.innerHTML = "<strong>" + escapeHtml(agent.displayName || agent.name) + "</strong>" +
      "<span class=\"agent-name\">" + escapeHtml(agent.name) + "</span>" +
      "<span class=\"agent-mode-badge\">" + escapeHtml(agent.mode || "subagent") + "</span>" +
      (agent.description ? "<p class=\"agent-desc\">" + escapeHtml(agent.description) + "</p>" : "");
    nameButton.addEventListener("click", () => insertAgentPrompt(agent));
    info.append(nameButton);

    const actions = document.createElement("div");
    actions.className = "agent-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.title = "Edit";
    editBtn.textContent = "✎";
    editBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openAgentModal(agent);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.title = "Delete";
    deleteBtn.className = "agent-delete";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!confirm('Delete agent "' + (agent.displayName || agent.name) + '"?')) return;
      try {
        const payload = await requestJson("/api/agents/" + encodeURIComponent(agent.name), {
          method: "DELETE",
        });
        state.agents = payload.agents || [];
        renderAgents();
      } catch (error) {
        renderAgents(error.message);
      }
    });

    actions.append(editBtn, deleteBtn);
    header.append(info, actions);
    item.append(header);
    elements.agents.append(item);
  }
}

function insertAgentPrompt(agent) {
  const prefix = "Use the " + agent.name + " agent for this request.\n";
  const current = elements.prompt.value.trimStart();
  elements.prompt.value = current.startsWith(prefix) ? current : prefix + current;
  elements.prompt.focus();
}

function openAgentModal(agent = null) {
  state.editingAgent = agent;
  state.agentModalOpen = true;

  elements.agentModalTitle.textContent = agent ? "Edit Agent" : "New Agent";
  elements.agentName.value = agent ? agent.name : "";
  elements.agentName.disabled = Boolean(agent);
  elements.agentDisplayName.value = agent ? (agent.displayName || "") : "";
  elements.agentMode.value = agent ? (agent.mode || "subagent") : "subagent";
  elements.agentDescription.value = agent ? (agent.description || "") : "";
  elements.agentPrompt.value = agent ? (agent.prompt || "") : "";
  elements.agentModel.value = agent ? (agent.model || "") : "";
  elements.agentEnabled.checked = agent ? agent.enabled !== false : true;

  elements.agentModal.hidden = false;
  elements.agentName.focus();
}

function closeAgentModal() {
  state.editingAgent = null;
  state.agentModalOpen = false;
  elements.agentModal.hidden = true;
}

async function saveAgent() {
  const data = {
    name: elements.agentName.value.trim(),
    displayName: elements.agentDisplayName.value.trim() || elements.agentName.value.trim(),
    mode: elements.agentMode.value,
    description: elements.agentDescription.value.trim(),
    prompt: elements.agentPrompt.value.trim(),
    model: elements.agentModel.value.trim() || undefined,
    enabled: elements.agentEnabled.checked,
  };

  if (!data.name) {
    elements.agentName.focus();
    return;
  }

  if (!data.description) {
    elements.agentDescription.focus();
    return;
  }

  const isEditing = Boolean(state.editingAgent);
  const url = isEditing
    ? "/api/agents/" + encodeURIComponent(state.editingAgent.name)
    : "/api/agents";
  const method = isEditing ? "PATCH" : "POST";

  try {
    const payload = await requestJson(url, {
      method,
      body: data,
    });
    state.agents = payload.agents || [];
    renderAgents();
    closeAgentModal();
  } catch (error) {
    renderAgents(error.message);
  }
}

function renderKnowledge(errorMessage) {
  elements.knowledgeTree.innerHTML = "";
  elements.knowledgeRoot.textContent = state.knowledgeRoot || "-";
  elements.knowledgeCount.textContent = String(countKnowledgeFiles(state.knowledgeTree));

  if (errorMessage) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = `<strong>Unavailable</strong><p>${escapeHtml(errorMessage)}</p>`;
    elements.knowledgeTree.append(item);
    return;
  }

  const hasContent = state.knowledgeTree.files.length > 0 || state.knowledgeTree.folders.length > 0;
  if (!hasContent) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = "<strong>暂无知识</strong><p>创建目录或文档后会显示在这里。</p>";
    elements.knowledgeTree.append(item);
    return;
  }

  for (const folder of state.knowledgeTree.folders) {
    elements.knowledgeTree.append(buildKnowledgeFolderNode(folder));
  }

  for (const file of state.knowledgeTree.files) {
    elements.knowledgeTree.append(buildKnowledgeFileNode(file));
  }
}

function buildKnowledgeFolderNode(folder) {
  const article = document.createElement("article");
  article.className = "knowledge-node";

  const row = document.createElement("div");
  row.className = "knowledge-row";

  const info = document.createElement("div");
  info.className = "knowledge-info";
  const refButton = document.createElement("button");
  refButton.type = "button";
  refButton.className = "knowledge-ref";
  refButton.innerHTML = `<strong>${escapeHtml(folder.name)}</strong><span>@knowledge/${escapeHtml(folder.path)}</span>`;
  refButton.addEventListener("click", () => addKnowledgeReference({ type: "folder", path: folder.path }));
  info.append(refButton);

  const tools = document.createElement("div");
  tools.className = "knowledge-tools";
  tools.append(
    createInlineAction("引用", () => addKnowledgeReference({ type: "folder", path: folder.path })),
    createInlineAction("改名", () => openKnowledgeModal({ kind: "folder", mode: "rename", target: folder })),
    createInlineAction("删", async () => {
      if (!confirm(`Delete folder "${folder.path}"?`)) return;
      await deleteKnowledgeFolderEntry(folder.path);
    }),
  );

  row.append(info, tools);
  article.append(row);

  const children = document.createElement("div");
  children.className = "knowledge-node-children";
  for (const childFolder of folder.folders || []) children.append(buildKnowledgeFolderNode(childFolder));
  for (const childFile of folder.files || []) children.append(buildKnowledgeFileNode(childFile));
  if (children.childNodes.length > 0) article.append(children);

  return article;
}

function buildKnowledgeFileNode(file) {
  const article = document.createElement("article");
  article.className = "knowledge-file";

  const row = document.createElement("div");
  row.className = "knowledge-row";

  const info = document.createElement("div");
  info.className = "knowledge-info";
  const refButton = document.createElement("button");
  refButton.type = "button";
  refButton.className = "knowledge-ref";
  refButton.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>@knowledge/${escapeHtml(file.path)}</span>`;
  refButton.addEventListener("click", () => addKnowledgeReference({ type: "file", path: file.path }));
  info.append(refButton);

  const tools = document.createElement("div");
  tools.className = "knowledge-tools";
  tools.append(
    createInlineAction("引用", () => addKnowledgeReference({ type: "file", path: file.path })),
    createInlineAction("编辑", async () => {
      const payload = await requestJson(`/api/knowledge/file?path=${encodeURIComponent(file.path)}`);
      openKnowledgeModal({ kind: "file", mode: "edit", target: file, content: payload.content || "" });
    }),
    createInlineAction("删", async () => {
      if (!confirm(`Delete file "${file.path}"?`)) return;
      await deleteKnowledgeFileEntry(file.path);
    }),
  );

  row.append(info, tools);
  article.append(row);
  return article;
}

function createInlineAction(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function countKnowledgeFiles(node) {
  const localFiles = Array.isArray(node?.files) ? node.files.length : 0;
  const nestedFolders = Array.isArray(node?.folders) ? node.folders : [];
  return localFiles + nestedFolders.reduce((total, folder) => total + countKnowledgeFiles(folder), 0);
}

function addKnowledgeReference(reference) {
  const key = `${reference.type}:${reference.path}`;
  const exists = state.referencedKnowledge.some((item) => `${item.type}:${item.path}` === key);
  if (exists) return;
  state.referencedKnowledge.push(reference);
  renderKnowledgeReferences();
}

function renderKnowledgeReferences() {
  elements.knowledgeReferenceTags.innerHTML = "";
  const hasReferences = state.referencedKnowledge.length > 0;
  elements.knowledgeReferences.hidden = !hasReferences;
  if (!hasReferences) return;

  for (const reference of state.referencedKnowledge) {
    const tag = document.createElement("div");
    tag.className = "reference-tag";

    if (reference.type === "repo") {
      tag.innerHTML = `<span class="ref-repo">📦 @repo/${escapeHtml(reference.path)}</span>`;
    } else {
      tag.innerHTML = `<span>@knowledge/${escapeHtml(reference.path)}</span>`;
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "✕";
    remove.addEventListener("click", () => {
      state.referencedKnowledge = state.referencedKnowledge.filter((item) => !(item.type === reference.type && item.path === reference.path));
      renderKnowledgeReferences();
    });

    tag.append(remove);
    elements.knowledgeReferenceTags.append(tag);
  }
}

function openKnowledgeModal({ kind = "file", mode = "create", target = null, content = "" } = {}) {
  state.knowledgeModalOpen = true;
  state.knowledgeModalMode = mode;
  state.editingKnowledge = target ? { ...target, kind } : null;
  elements.knowledgeKind.value = kind;
  elements.knowledgeKind.disabled = mode !== "create";

  const parentPath = target ? parentPathOf(target.path) : "";
  elements.knowledgeParent.value = parentPath;
  elements.knowledgeName.value = target ? target.name : "";
  elements.knowledgeContent.value = content;
  elements.knowledgeModalTitle.textContent = mode === "create"
    ? (kind === "folder" ? "New Folder" : "New Knowledge")
    : (kind === "folder" ? "Rename Folder" : "Edit Knowledge");
  syncKnowledgeModalFields();
  elements.knowledgeModal.hidden = false;
  elements.knowledgeName.focus();
}

function syncKnowledgeModalFields() {
  const kind = elements.knowledgeKind.value;
  const showContent = kind === "file";
  elements.knowledgeContentWrap.hidden = !showContent;
}

function closeKnowledgeModal() {
  state.knowledgeModalOpen = false;
  state.editingKnowledge = null;
  elements.knowledgeModal.hidden = true;
}

async function saveKnowledgeEntry() {
  const kind = elements.knowledgeKind.value;
  const mode = state.knowledgeModalMode;
  const parent = normalizeKnowledgeParent(elements.knowledgeParent.value);
  const name = elements.knowledgeName.value.trim();
  if (!name) {
    elements.knowledgeName.focus();
    return;
  }

  const fullPath = joinKnowledgePath(parent, name);

  try {
    if (kind === "folder") {
      if (mode === "create") {
        await requestJson("/api/knowledge/folders", { method: "POST", body: { path: fullPath } });
      } else {
        await requestJson("/api/knowledge/folders", {
          method: "PATCH",
          body: { from: state.editingKnowledge.path, to: fullPath },
        });
      }
    } else if (mode === "create") {
      await requestJson("/api/knowledge/files", {
        method: "POST",
        body: { path: fullPath, content: elements.knowledgeContent.value },
      });
    } else {
      const originalPath = state.editingKnowledge.path;
      if (originalPath !== fullPath) {
        await requestJson("/api/knowledge/files", {
          method: "PATCH",
          body: { from: originalPath, to: fullPath },
        });
      }
      await requestJson("/api/knowledge/files", {
        method: "PATCH",
        body: { path: fullPath, content: elements.knowledgeContent.value },
      });
    }

    await loadKnowledge();
    closeKnowledgeModal();
  } catch (error) {
    renderKnowledge(error.message);
  }
}

async function deleteKnowledgeFolderEntry(path) {
  try {
    await requestJson("/api/knowledge/folders", {
      method: "DELETE",
      body: { path },
    });
    state.referencedKnowledge = state.referencedKnowledge.filter((item) => item.path !== path && !item.path.startsWith(`${path}/`));
    renderKnowledgeReferences();
    await loadKnowledge();
  } catch (error) {
    renderKnowledge(error.message);
  }
}

async function deleteKnowledgeFileEntry(path) {
  try {
    await requestJson("/api/knowledge/files", {
      method: "DELETE",
      body: { path },
    });
    state.referencedKnowledge = state.referencedKnowledge.filter((item) => item.path !== path);
    renderKnowledgeReferences();
    await loadKnowledge();
  } catch (error) {
    renderKnowledge(error.message);
  }
}

function normalizeKnowledgeParent(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function joinKnowledgePath(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

function parentPathOf(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function prependKnowledgeReferences(text, references) {
  const normalizedText = String(text || "").trim();
  const lines = [];
  const seen = new Set();

  for (const reference of references || []) {
    const relativePath = String(reference?.path || "").trim().replace(/^\/+/, "");
    if (!relativePath) continue;

    const prefix = reference.type === "repo" ? "@repo" : "@knowledge";
    const line = `${prefix}/${relativePath}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }

  if (lines.length === 0) return normalizedText;
  if (!normalizedText) return lines.join("\n");
  return `${lines.join("\n")}\n\n${normalizedText}`;
}

function resetThinking(sessionID, label) {
  state.thinkingSessionID = sessionID;
  state.thinkingEntries = [];
  state.pendingPermissions = [];
  state.thinkingExpanded = false;
  state.thinkingActive = true;
  state.thinkingStatus = label || "正在分析";
  addThinkingEntry({
    kind: "status",
    label: state.thinkingStatus,
  });
}

function addThinkingEntry(entry = {}) {
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

  state.thinkingEntries.push({
    kind,
    label,
    detail,
    time: entry.time || Date.now(),
  });
  state.thinkingEntries = state.thinkingEntries.slice(-80);
  state.thinkingStatus = label || state.thinkingStatus;
}

function finishThinking(label) {
  if (!state.thinkingSessionID || state.thinkingSessionID !== state.currentSessionID) return;

  state.thinkingActive = false;
  state.thinkingStatus = label || state.thinkingStatus || "已完成";
  addThinkingEntry({
    kind: label?.includes("失败") || label?.includes("出错") ? "error" : "done",
    label: state.thinkingStatus,
  });
}

function addPermission(permission) {
  if (!permission?.id) return;
  if (state.pendingPermissions.some((item) => item.id === permission.id)) return;
  state.pendingPermissions.push(permission);
  state.pendingPermissions = state.pendingPermissions.slice(-10);
}

function removePermission(permissionID) {
  state.pendingPermissions = state.pendingPermissions.filter((item) => item.id !== permissionID);
}

function hasPendingPermissions() {
  return state.pendingPermissions.length > 0 && state.thinkingSessionID === state.currentSessionID;
}

async function respondToPermission(permissionID, response) {
  const sessionID = state.currentSessionID;
  if (!sessionID) return;
  try {
    await requestJson(`/api/sessions/${encodeURIComponent(sessionID)}/permissions/${encodeURIComponent(permissionID)}`, {
      method: "POST",
      body: { response },
    });
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

function shouldRenderThinking() {
  return state.thinkingSessionID === state.currentSessionID && state.thinkingEntries.length > 0;
}

function resetAnswerDetail(sessionID) {
  state.answerDetailSessionID = sessionID;
  state.answerDetailText = "";
}

function rememberAnswerDetailsFromMessages(sessionID, messages, promptText = "") {
  const visibleMessages = collectVisibleMessages(messages);
  const answerIndex = findAnswerIndexForPrompt(visibleMessages, promptText);
  if (answerIndex >= 0) {
    rememberAnswerDetail(sessionID, visibleMessages[answerIndex].text);
  }
}

function rememberAnswerDetail(sessionID, text) {
  if (!sessionID || sessionID !== state.currentSessionID) return;

  const candidate = String(text || "").trim();
  if (!candidate) return;

  const current = String(state.answerDetailText || "").trim();
  if (candidate.length <= current.length) return;

  state.answerDetailSessionID = sessionID;
  state.answerDetailText = candidate;
}

function storeAnswerDetailForMessages(sessionID, messages, promptText = "") {
  if (!sessionID || sessionID !== state.currentSessionID) return;

  const visibleMessages = collectVisibleMessages(messages);
  const answerIndex = findAnswerIndexForPrompt(visibleMessages, promptText);
  if (answerIndex < 0) return;

  const finalText = visibleMessages[answerIndex]?.text || "";
  const detailText = getUsefulAnswerDetailText(finalText, state.answerDetailText);
  if (!detailText) return;

  const detailKey = getAnswerDetailKey(sessionID, answerIndex, finalText);
  state.answerDetails[detailKey] = detailText;
}

function findAnswerIndexForPrompt(visibleMessages, promptText = "") {
  if (!promptText) return findLastAssistantIndex(visibleMessages);

  const prompt = normalizeAnswerText(promptText);
  let promptIndex = -1;

  for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
    const message = visibleMessages[index];
    if (message?.role !== "user") continue;

    const userText = normalizeAnswerText(message.text);
    if (userText === prompt || userText.endsWith(prompt) || prompt.endsWith(userText)) {
      promptIndex = index;
      break;
    }
  }

  if (promptIndex < 0) return -1;

  for (let index = visibleMessages.length - 1; index > promptIndex; index -= 1) {
    if (visibleMessages[index]?.role === "assistant") return index;
  }

  return -1;
}

function getAnswerDetailConfig(messageIndex, finalText) {
  if (messageIndex < 0 || !finalText) return null;

  const detailKey = getAnswerDetailKey(state.currentSessionID, messageIndex, finalText);
  const storedDetail = state.answerDetails[detailKey];
  const draftDetail = state.answerDetailSessionID === state.currentSessionID
    ? getUsefulAnswerDetailText(finalText, state.answerDetailText)
    : "";
  const detailText = storedDetail || draftDetail;
  if (!detailText) return null;

  return {
    key: detailKey,
    text: detailText,
    expanded: state.answerDetailExpandedKeys.has(detailKey),
  };
}

function getUsefulAnswerDetailText(finalText, detailText) {
  const detail = String(detailText || "").trim();
  const finalAnswer = String(finalText || "").trim();
  if (!detail || !finalAnswer) return "";

  const normalizedDetail = normalizeAnswerText(detail);
  const normalizedFinal = normalizeAnswerText(finalAnswer);
  if (!normalizedDetail || !normalizedFinal) return "";
  if (normalizedDetail === normalizedFinal) return "";
  if (normalizedFinal.includes(normalizedDetail)) return "";

  const minimumExtraLength = Math.max(48, Math.round(normalizedFinal.length * 0.25));
  if (normalizedDetail.length <= normalizedFinal.length + minimumExtraLength) return "";

  return detail;
}

function normalizeAnswerText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function getAnswerDetailKey(sessionID, messageIndex, finalText) {
  return `${sessionID || "session"}:${messageIndex}:${hashText(finalText)}`;
}

function hashText(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function appendAnswerDetail(detailConfig) {
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

function appendThinkingPanel() {
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

function appendPermissionPanel() {
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
    const patterns = Array.isArray(rawPattern) ? rawPattern : (rawPattern ? [rawPattern] : []);
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

function syncThinkingScroll() {
  const log = elements.messages.querySelector(".thinking-log");
  if (log) log.scrollTop = log.scrollHeight;
}

function formatShortTime(value) {
  const date = new Date(value || Date.now());
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function appendLocalMessage(role, text) {
  appendMessage(role, text);
}

function appendMessage(role, text, options = {}) {
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

function showEmpty(text) {
  elements.messages.innerHTML = "";
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = text;
  elements.messages.append(empty);
  state.messagesPinnedToBottom = true;
  updateJumpLatestButton();
}

function hasScrollableMessages() {
  return elements.messages.scrollHeight > elements.messages.clientHeight + 2;
}

function isMessagesAtBottom() {
  const distance = elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight;
  return distance < 24;
}

function scrollMessagesToBottom(behavior = "auto") {
  elements.messages.scrollTo({
    top: elements.messages.scrollHeight,
    behavior,
  });
  state.messagesPinnedToBottom = true;
  updateJumpLatestButton();
}

function updateJumpLatestButton() {
  const shouldShow = hasScrollableMessages() && !state.messagesPinnedToBottom;
  elements.jumpLatest.hidden = !shouldShow;
}

async function requestJson(path, options = {}) {
  const headers = options.headers || (options.body ? { "content-type": "application/json" } : undefined);
  const body = options.rawBody ?? (options.body ? JSON.stringify(options.body) : undefined);
  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body,
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || response.statusText);
  }

  return payload;
}

async function readJsonResponse(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function readSseStream(stream, onEvent) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replaceAll("\r\n", "\n");

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      await emitSseBlock(rawEvent, onEvent);
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
}

async function emitSseBlock(rawEvent, onEvent) {
  let event = "message";
  const data = [];

  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }

  if (data.length === 0) return;
  await onEvent(event, JSON.parse(data.join("\n")));
}

function setBusy(value, label = "") {
  state.busy = value;
  elements.send.disabled = value;
  elements.newSession.disabled = value;
  elements.refresh.disabled = value;
  elements.restartRuntime.disabled = value || state.runtimeRestarting;
  elements.sendState.textContent = label;
  renderModelPicker();
}

function renderModelPicker() {
  const current = state.models.find((item) => item.id === state.selectedModel);
  elements.modelToggle.textContent = current?.label || current?.id || "Default model";
  elements.modelToggle.disabled = state.busy || state.models.length === 0;
  elements.modelToggle.setAttribute("aria-expanded", String(state.modelPickerOpen));
  elements.modelMenu.toggleAttribute("open", state.modelPickerOpen);
  elements.modelSearch.disabled = state.busy || state.models.length === 0;
  if (elements.modelSearch.value !== state.modelQuery) {
    elements.modelSearch.value = state.modelQuery;
  }
  renderModelOptions();
}

function renderModelOptions() {
  const container = elements.modelOptions;
  container.innerHTML = "";

  if (state.models.length === 0) {
    const empty = document.createElement("div");
    empty.className = "model-option empty";
    empty.textContent = "No configured models";
    container.append(empty);
    return;
  }

  const query = state.modelQuery.trim().toLowerCase();
  const filtered = state.models
    .filter((model) => {
      if (!query) return true;
      return [model.id, model.label]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    })
    .slice(0, 10);

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "model-option empty";
    empty.textContent = "No matching models";
    container.append(empty);
    return;
  }

  for (const model of filtered) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `model-option${model.id === state.selectedModel ? " selected" : ""}`;
    button.innerHTML = `<strong>${escapeHtml(model.label || model.id)}</strong><span>${escapeHtml(model.id)}</span>`;
    button.addEventListener("click", () => {
      state.selectedModel = model.id;
      state.modelPickerOpen = false;
      state.modelQuery = "";
      renderModelPicker();
    });
    container.append(button);
  }
}

function syncRuntimeRestartButton() {
  elements.restartRuntime.disabled = state.busy || state.runtimeRestarting;
  elements.restartRuntime.textContent = state.runtimeRestarting ? "Restarting..." : "Restart Runtime";
}

function setSkillUploadState(text, isError = false) {
  elements.skillUploadState.textContent = text || "同名覆盖";
  elements.skillDropzone.classList.toggle("is-error", Boolean(isError));
}

function setMcpUploadState(text, isError = false) {
  elements.mcpUploadState.textContent = text || "同名覆盖";
  elements.mcpDropzone.classList.toggle("is-error", Boolean(isError));
}

function setKernelStatus(text, stateName) {
  elements.kernelStatus.textContent = text;
  elements.factStatus.textContent = text;
  elements.kernelDot.className = `dot ${stateName || ""}`.trim();
}

function formatTime(value) {
  if (!value) return "No activity";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdown(markdown) {
  const lines = String(markdown).split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += index < lines.length ? 1 : 0;
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (isTableStart(lines, index)) {
      const rows = [];
      rows.push(splitTableRow(lines[index]));
      index += 2;
      while (index < lines.length && isTableRow(lines[index])) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      const [head, ...body] = rows;
      html.push(`<table><thead><tr>${head.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length + 1;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quote = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${quote.map((item) => `<p>${renderInline(item)}</p>`).join("")}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      html.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length
      && lines[index].trim()
      && !lines[index].startsWith("```")
      && !isTableStart(lines, index)
      && !/^(#{1,4})\s+/.test(lines[index])
      && !lines[index].startsWith(">")
      && !/^\s*[-*]\s+/.test(lines[index])
      && !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return html.join("");
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function isTableStart(lines, index) {
  return isTableRow(lines[index]) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function isTableRow(line) {
  return /^\s*\|.+\|\s*$/.test(line);
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

// Marketplace Logic
async function loadMarketplace() {
  if (!elements.marketplaceList) return;
  try {
    const payload = await requestJson("/api/marketplace");
    state.marketplaceBundles = payload.bundles || [];
    renderMarketplace();
  } catch (error) {
    state.marketplaceBundles = [];
    renderMarketplace(error.message);
  }
}

function renderMarketplace(errorMessage) {
  if (!elements.marketplaceList) return;
  elements.marketplaceList.innerHTML = "";

  if (errorMessage) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = `<strong>Unavailable</strong><p>${escapeHtml(errorMessage)}</p>`;
    elements.marketplaceList.append(item);
    return;
  }

  if (state.marketplaceBundles.length === 0) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = "<strong>No bundles</strong><p>The marketplace is empty.</p>";
    elements.marketplaceList.append(item);
    return;
  }

  for (const bundle of state.marketplaceBundles) {
    const item = document.createElement("article");
    item.className = "marketplace-bundle";

    const header = document.createElement("div");
    header.className = "marketplace-bundle-header";

    if (bundle.icon) {
      const img = document.createElement("img");
      img.src = bundle.icon;
      img.className = "marketplace-bundle-icon";
      img.alt = "";
      header.append(img);
    } else {
      const fallback = document.createElement("div");
      fallback.className = "marketplace-bundle-icon";
      header.append(fallback);
    }

    const info = document.createElement("div");
    info.className = "marketplace-bundle-info";
    
    let maturityHTML = '';
    if (bundle.maturity) {
       maturityHTML = `<span style="display:inline-block; border:1px solid var(--line); border-radius:4px; padding:1px 4px; font-size:9px; margin-left:6px; vertical-align:middle;">${escapeHtml(bundle.maturity)}</span>`;
    }

    info.innerHTML = `
      <strong>${escapeHtml(bundle.name || bundle.id)}${maturityHTML}</strong>
      <span>${escapeHtml(bundle.id)} (v${escapeHtml(bundle.version || '1.0.0')})</span>
    `;

    const desc = document.createElement("p");
    desc.className = "marketplace-bundle-desc";
    desc.textContent = bundle.description || "";

    const tags = document.createElement("div");
    tags.className = "marketplace-bundle-tags";
    if (bundle.tags && Array.isArray(bundle.tags)) {
      for (const tag of bundle.tags) {
        const t = document.createElement("span");
        t.className = "marketplace-bundle-tag";
        t.textContent = tag;
        tags.append(t);
      }
    }

    info.append(desc, tags);
    header.append(info);

    const installBtn = document.createElement("button");
    installBtn.className = "ghost marketplace-bundle-install";
    installBtn.textContent = `Install (${bundle.itemCount || 0} items)`;
    installBtn.onclick = () => installMarketplaceBundle(bundle.id, installBtn);

    item.append(header, installBtn);
    elements.marketplaceList.append(item);
  }
}

async function installMarketplaceBundle(bundleId, buttonEl) {
  const originalText = buttonEl.textContent;
  buttonEl.textContent = "Installing...";
  buttonEl.disabled = true;

  try {
    const res = await fetch(`/api/marketplace/${encodeURIComponent(bundleId)}/install`, {
      method: "POST"
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.message || payload.error || "Install failed");
    }

    buttonEl.textContent = `Installed ${payload.installed ? payload.installed.length : 0} items`;
    buttonEl.classList.remove("ghost");
    buttonEl.classList.add("primary");
    setTimeout(() => {
      buttonEl.textContent = originalText;
      buttonEl.disabled = false;
      buttonEl.classList.remove("primary");
      buttonEl.classList.add("ghost");
    }, 3000);

    // Refresh everything
    refreshAll();

  } catch (error) {
    alert("Install failed: " + error.message);
    buttonEl.textContent = "Failed";
    setTimeout(() => {
      buttonEl.textContent = originalText;
      buttonEl.disabled = false;
    }, 3000);
  }
}

// Upload handlers
if (elements.uploadSkills) {
  elements.uploadSkills.addEventListener("click", () => { elements.marketplaceUploadFile.click(); });
}
if (elements.uploadMcp) {
  elements.uploadMcp.addEventListener("click", () => { elements.marketplaceUploadFile.click(); });
}
if (elements.uploadAgents) {
  elements.uploadAgents.addEventListener("click", () => { elements.marketplaceUploadFile.click(); });
}
if (elements.uploadKnowledge) {
  elements.uploadKnowledge.addEventListener("click", () => { elements.marketplaceUploadFile.click(); });
}

if (elements.marketplaceUploadFile) {
  elements.marketplaceUploadFile.addEventListener("change", async () => {
    const file = elements.marketplaceUploadFile.files[0];
    if (!file) return;

    try {
      const res = await fetch("/api/marketplace/upload", {
        method: "POST",
        headers: {
          "x-file-name": encodeURIComponent(file.name)
        },
        body: file
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.message || payload.error || "Upload failed");
      }

      alert("Upload successful! Bundle ID: " + (payload.entry?.id || "unknown"));
      elements.marketplaceUploadFile.value = "";
      refreshAll();

    } catch (error) {
      alert("Upload failed: " + error.message);
      elements.marketplaceUploadFile.value = "";
    }
  });
}

// Marketplace archive button
if (elements.marketplaceArchive) {
  elements.marketplaceArchive.addEventListener("click", async () => {
    const btn = elements.marketplaceArchive;
    const originalText = btn.textContent;
    btn.textContent = "归档中…";
    btn.disabled = true;

    try {
      const res = await fetch("/api/marketplace/snapshot", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.message || payload.error || "Archive failed");
      }
      btn.textContent = "归档完成";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    } catch (error) {
      alert("归档失败: " + error.message);
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
}

// Repo / 代码库 logic

async function loadRepos() {
  try {
    const payload = await requestJson("/api/repos");
    state.repos = payload.repos || [];
    renderRepos();
  } catch (error) {
    state.repos = [];
    renderRepos(error.message);
  }
}

function renderRepos(errorMessage) {
  elements.repos.innerHTML = "";
  elements.repoCount.textContent = String(state.repos.length);

  if (errorMessage) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = `<strong>Unavailable</strong><p>${escapeHtml(errorMessage)}</p>`;
    elements.repos.append(item);
    return;
  }

  if (state.repos.length === 0) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = "<strong>暂无代码库</strong><p>点击上方按钮添加代码仓库。</p>";
    elements.repos.append(item);
    return;
  }

  for (const repo of state.repos) {
    const item = document.createElement("article");
    item.className = "repo-item";

    const header = document.createElement("div");
    header.className = "repo-item-header";

    const info = document.createElement("div");
    info.className = "repo-item-info";

    const statusChip = renderRepoStatusChip(repo.status, repo.error_msg);

    info.innerHTML = `
      <strong>${escapeHtml(repo.name)}</strong>
      <span class="repo-url" title="${escapeHtml(repo.url)}">${escapeHtml(truncateUrl(repo.url))}</span>
      ${repo.branch ? `<span class="repo-meta">branch: ${escapeHtml(repo.branch)}${repo.depth > 0 ? ` · depth: ${repo.depth}` : ""}</span>` : ""}
    `;

    const actions = document.createElement("div");
    actions.className = "repo-actions";

    if (repo.status === "success") {
      const refBtn = document.createElement("button");
      refBtn.type = "button";
      refBtn.title = "引用";
      refBtn.className = "repo-ref";
      refBtn.textContent = "引用";
      refBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        addKnowledgeReference({ type: "repo", path: repo.name });
      });
      actions.append(refBtn);
    }

    if (repo.status === "failed") {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "ghost";
      retryBtn.textContent = "重试";
      retryBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        await retryRepo(repo.name);
      });
      actions.append(retryBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.title = "Delete";
    deleteBtn.className = "repo-delete";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!confirm(`Delete repo "${repo.name}"?`)) return;
      try {
        const payload = await requestJson(`/api/repos/${encodeURIComponent(repo.name)}`, {
          method: "DELETE",
        });
        state.repos = payload.repos || [];
        state.referencedKnowledge = state.referencedKnowledge.filter((item) => !(item.type === "repo" && item.path === repo.name));
        renderKnowledgeReferences();
        renderRepos();
      } catch (error) {
        renderRepos(error.message);
      }
    });

    actions.append(deleteBtn);
    header.append(info, statusChip, actions);
    item.append(header);

    if (repo.error_msg) {
      const errorBlock = document.createElement("div");
      errorBlock.className = "repo-error";
      errorBlock.textContent = repo.error_msg;
      item.append(errorBlock);
    }

    elements.repos.append(item);
  }
}

function renderRepoStatusChip(status, errorMessage) {
  const chip = document.createElement("span");
  chip.className = `repo-status-chip ${status}`;

  switch (status) {
    case "pulling":
      chip.innerHTML = `<span class="repo-spinner" aria-hidden="true"></span> 拉取中`;
      break;
    case "indexing":
      chip.innerHTML = `<span class="repo-spinner" aria-hidden="true"></span> 索引中`;
      break;
    case "success":
      chip.textContent = "就绪";
      break;
    case "failed":
      chip.textContent = "拉取失败";
      chip.title = errorMessage || "";
      break;
    default:
      chip.textContent = status;
  }

  return chip;
}

function truncateUrl(url) {
  const str = String(url);
  if (str.length <= 52) return str;
  return str.slice(0, 28) + "..." + str.slice(-21);
}

async function retryRepo(name) {
  try {
    const payload = await requestJson(`/api/repos/${encodeURIComponent(name)}/retry`, {
      method: "POST",
    });
    state.repos = payload.repos || [];
    renderRepos();
  } catch (error) {
    renderRepos(error.message);
  }
}

function openRepoModal() {
  state.repoModalOpen = true;
  elements.repoUrl.value = "";
  elements.repoBranch.value = "";
  elements.repoDepth.value = "0";
  elements.repoUsername.value = "";
  elements.repoEmail.value = "";
  elements.repoPassword.value = "";
  elements.repoToken.value = "";
  elements.repoSshKey.value = "";
  elements.repoModal.hidden = false;
  elements.repoUrl.focus();
}

function closeRepoModal() {
  state.repoModalOpen = false;
  elements.repoModal.hidden = true;
}

async function saveRepo() {
  const url = elements.repoUrl.value.trim();
  if (!url) {
    elements.repoUrl.focus();
    return;
  }

  const data = {
    url,
    branch: elements.repoBranch.value.trim(),
    depth: Number(elements.repoDepth.value) || 0,
    username: elements.repoUsername.value.trim(),
    email: elements.repoEmail.value.trim(),
    password: elements.repoPassword.value,
    token: elements.repoToken.value,
    ssh_key: elements.repoSshKey.value,
  };

  try {
    const payload = await requestJson("/api/repos", {
      method: "POST",
      body: data,
    });
    state.repos = payload.repos || [];
    renderRepos();
    closeRepoModal();
  } catch (error) {
    renderRepos(error.message);
  }
}
