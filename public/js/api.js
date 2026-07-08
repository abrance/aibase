import { state, setKernelStatus, syncRuntimeRestartButton, setSkillUploadState, setMcpUploadState } from "./state.js";
import { elements } from "./elements.js";

export async function requestJson(path, options = {}) {
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

export async function readSseStream(stream, onEvent) {
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

export async function loadHealth() {
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

export async function restartRuntime() {
  if (state.runtimeRestarting || state.busy) return;
  state.runtimeRestarting = true;
  syncRuntimeRestartButton();
  setKernelStatus("Restarting", "warn");
  try {
    await requestJson("/api/runtime/restart", { method: "POST" });
    setKernelStatus("Ready", "ok");
  } catch (error) {
    setKernelStatus(error.message, "error");
  } finally {
    state.runtimeRestarting = false;
    syncRuntimeRestartButton();
  }
}

export async function loadSkills() {
  try {
    const payload = await requestJson("/api/skills");
    state.skills = payload.skills || [];
  } catch (error) {
    state.skills = [];
    return error.message;
  }
  return null;
}

export async function loadMcpDocuments() {
  try {
    const payload = await requestJson("/api/mcp");
    state.mcpDocs = payload.documents || [];
    elements.factEnvUrl.textContent = payload.environmentBaseURL || "未配置";
  } catch (error) {
    state.mcpDocs = [];
    return error.message;
  }
  return null;
}

export async function loadKnowledge() {
  try {
    const payload = await requestJson("/api/knowledge");
    state.knowledgeTree = payload.tree || { folders: [], files: [] };
    state.knowledgeRoot = payload.root || "";
  } catch (error) {
    state.knowledgeTree = { folders: [], files: [] };
    state.knowledgeRoot = "";
    return error.message;
  }
  return null;
}

export async function uploadSkillZip(file) {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    setSkillUploadState("仅支持 ZIP", true);
    return null;
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
    const action = payload.overwritten ? "已更新" : "已导入";
    setSkillUploadState(`${action} ${payload.name}`);
    return payload;
  } catch (error) {
    setSkillUploadState(error.message, true);
    return null;
  }
}

export async function uploadMcpDocument(file) {
  if (!/\.(md|markdown)$/i.test(file.name)) {
    setMcpUploadState("仅支持 Markdown", true);
    return null;
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
    const action = payload.overwritten ? "已更新" : "已导入";
    setMcpUploadState(`${action} ${payload.displayName || payload.name}`);
    return payload;
  } catch (error) {
    setMcpUploadState(error.message, true);
    return null;
  }
}

export async function loadSessions() {
  try {
    state.sessions = await requestJson("/api/sessions");
  } catch (error) {
    state.sessions = [];
    return error.message;
  }
  return null;
}

export async function loadMessages() {
  if (!state.currentSessionID) return null;
  try {
    return await requestJson(
      `/api/sessions/${encodeURIComponent(state.currentSessionID)}/messages`
    );
  } catch (error) {
    return null;
  }
}

export async function loadAgents() {
  try {
    const payload = await requestJson("/api/agents");
    state.agents = payload.agents || [];
  } catch (error) {
    state.agents = [];
    return error.message;
  }
  return null;
}

export async function loadMarketplace() {
  try {
    const payload = await requestJson("/api/marketplace");
    state.marketplaceBundles = payload.bundles || [];
  } catch (error) {
    state.marketplaceBundles = [];
    return error.message;
  }
  return null;
}

export async function loadRepos() {
  try {
    const payload = await requestJson("/api/repos");
    state.repos = payload.repos || [];
  } catch (error) {
    state.repos = [];
    return error.message;
  }
  return null;
}

export async function installMarketplaceBundle(bundleId, buttonEl) {
  const originalText = buttonEl.textContent;
  buttonEl.textContent = "Installing...";
  buttonEl.disabled = true;
  try {
    const res = await fetch(
      `/api/marketplace/${encodeURIComponent(bundleId)}/install`,
      { method: "POST" }
    );
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.message || payload.error || "Install failed");
    buttonEl.textContent = `Installed ${payload.installed ? payload.installed.length : 0} items`;
    buttonEl.classList.remove("ghost");
    buttonEl.classList.add("primary");
    setTimeout(() => {
      buttonEl.textContent = originalText;
      buttonEl.disabled = false;
      buttonEl.classList.remove("primary");
      buttonEl.classList.add("ghost");
    }, 3000);
    return true;
  } catch (error) {
    alert("Install failed: " + error.message);
    buttonEl.textContent = "Failed";
    setTimeout(() => {
      buttonEl.textContent = originalText;
      buttonEl.disabled = false;
    }, 3000);
    return false;
  }
}
