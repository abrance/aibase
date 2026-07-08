import { state } from "./state.js";
import { elements } from "./elements.js";
import { requestJson, loadKnowledge } from "./api.js";
import { renderAgents, renderKnowledge, renderRepos, renderKnowledgeReferences } from "./panels.js";

// Expose modal functions to panels.js via global namespace to avoid circular imports
if (typeof window !== "undefined") {
  window.__modals = window.__modals || {};
}

export function openAgentModal(agent = null) {
  state.editingAgent = agent;
  state.agentModalOpen = true;

  elements.agentModalTitle.textContent = agent ? "Edit Agent" : "New Agent";
  elements.agentName.value = agent ? agent.name : "";
  elements.agentName.disabled = Boolean(agent);
  elements.agentDisplayName.value = agent ? agent.displayName || "" : "";
  elements.agentMode.value = agent ? agent.mode || "subagent" : "subagent";
  elements.agentDescription.value = agent ? agent.description || "" : "";
  elements.agentPrompt.value = agent ? agent.prompt || "" : "";
  elements.agentModel.value = agent ? agent.model || "" : "";
  elements.agentEnabled.checked = agent ? agent.enabled !== false : true;

  elements.agentModal.hidden = false;
  elements.agentName.focus();
}

export function closeAgentModal() {
  state.editingAgent = null;
  state.agentModalOpen = false;
  elements.agentModal.hidden = true;
}

export async function saveAgent() {
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
    ? `/api/agents/${encodeURIComponent(state.editingAgent.name)}`
    : "/api/agents";
  const method = isEditing ? "PATCH" : "POST";

  try {
    const payload = await requestJson(url, { method, body: data });
    state.agents = payload.agents || [];
    renderAgents();
    closeAgentModal();
  } catch (error) {
    renderAgents(error.message);
  }
}

export function openKnowledgeModal({
  kind = "file",
  mode = "create",
  target = null,
  content = "",
} = {}) {
  state.knowledgeModalOpen = true;
  state.knowledgeModalMode = mode;
  state.editingKnowledge = target ? { ...target, kind } : null;
  elements.knowledgeKind.value = kind;
  elements.knowledgeKind.disabled = mode !== "create";

  const parentPath = target ? parentPathOf(target.path) : "";
  elements.knowledgeParent.value = parentPath;
  elements.knowledgeName.value = target ? target.name : "";
  elements.knowledgeContent.value = content;
  elements.knowledgeModalTitle.textContent =
    mode === "create"
      ? kind === "folder"
        ? "New Folder"
        : "New Knowledge"
      : kind === "folder"
        ? "Rename Folder"
        : "Edit Knowledge";
  syncKnowledgeModalFields();
  elements.knowledgeModal.hidden = false;
  elements.knowledgeName.focus();
}

export function closeKnowledgeModal() {
  state.knowledgeModalOpen = false;
  state.editingKnowledge = null;
  elements.knowledgeModal.hidden = true;
}

export function syncKnowledgeModalFields() {
  const kind = elements.knowledgeKind.value;
  const showContent = kind === "file";
  elements.knowledgeContentWrap.hidden = !showContent;
}

export async function saveKnowledgeEntry() {
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
        await requestJson("/api/knowledge/folders", {
          method: "POST",
          body: { path: fullPath },
        });
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

export async function deleteKnowledgeFolderEntry(path) {
  try {
    await requestJson("/api/knowledge/folders", {
      method: "DELETE",
      body: { path },
    });
    state.referencedKnowledge = state.referencedKnowledge.filter(
      (item) => item.path !== path && !item.path.startsWith(`${path}/`)
    );
    renderKnowledgeReferences();
    await loadKnowledge();
  } catch (error) {
    renderKnowledge(error.message);
  }
}

export async function deleteKnowledgeFileEntry(path) {
  try {
    await requestJson("/api/knowledge/files", {
      method: "DELETE",
      body: { path },
    });
    state.referencedKnowledge = state.referencedKnowledge.filter(
      (item) => item.path !== path
    );
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

export function openRepoModal() {
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

export function closeRepoModal() {
  state.repoModalOpen = false;
  elements.repoModal.hidden = true;
}

export async function saveRepo() {
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

export async function retryRepo(name) {
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

// Register modal helpers for panels.js circular import resolution
window.__modals.openKnowledgeModal = openKnowledgeModal;
window.__modals.closeKnowledgeModal = closeKnowledgeModal;
window.__modals.deleteKnowledgeFolderEntry = deleteKnowledgeFolderEntry;
window.__modals.deleteKnowledgeFileEntry = deleteKnowledgeFileEntry;
