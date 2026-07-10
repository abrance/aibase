import {
  state,
  initBusyBridge,
} from "./state.js";
import { elements } from "./elements.js";
import {
  loadHealth,
  restartRuntime as apiRestartRuntime,
  loadSkills,
  loadMcpDocuments,
  loadKnowledge,
  uploadSkillZip,
  uploadMcpDocument,
  loadAgents,
  loadMarketplace,
  loadRepos,
  requestJson,
} from "./api.js";
import { renderSessions, createSession } from "./sessions.js";
import { loadAndShowMessages, isMessagesAtBottom, updateJumpLatestButton, scrollMessagesToBottom, renderMessages } from "./chat.js";
import {
  renderSkills,
  renderMcpDocuments,
  renderAgents,
  renderKnowledge,
  renderMarketplace,
  renderRepos,
  renderModelPicker,
  renderModelOptions,
  renderKnowledgeReferences,
} from "./panels.js";
import { sendPrompt, loadModels } from "./composer.js";
import {
  openAgentModal,
  closeAgentModal,
  saveAgent,
  openKnowledgeModal,
  closeKnowledgeModal,
  syncKnowledgeModalFields,
  saveKnowledgeEntry,
  openRepoModal,
  closeRepoModal,
  saveRepo,
} from "./modals.js";

initBusyBridge(renderModelPicker);

function initTheme() {
  const saved = localStorage.getItem("aibase-theme");
  const prefers = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = saved === "dark" || (!saved && prefers);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  updateThemeIcon(dark);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const dark = current !== "dark";
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  localStorage.setItem("aibase-theme", dark ? "dark" : "light");
  updateThemeIcon(dark);
}

function updateThemeIcon(dark) {
  const btn = document.querySelector("#theme-toggle");
  if (btn) btn.textContent = dark ? "☾" : "☀";
}

document.querySelector("#theme-toggle")?.addEventListener("click", toggleTheme);
initTheme();

async function refreshAll() {
  await loadHealth();
  await loadModels();

  const skillsErr = await loadSkills();
  renderSkills(skillsErr);

  const mcpErr = await loadMcpDocuments();
  renderMcpDocuments(mcpErr);

  const agentsErr = await loadAgents();
  renderAgents(agentsErr);

  const knowledgeErr = await loadKnowledge();
  renderKnowledge(knowledgeErr);

  const reposErr = await loadRepos();
  renderRepos(reposErr);

  const marketplaceErr = await loadMarketplace();
  renderMarketplace(marketplaceErr);

  try {
    state.sessions = await requestJson("/api/sessions");
  } catch (error) {
    state.sessions = [];
  }

  if (
    state.currentSessionID &&
    !state.sessions.some((s) => s.id === state.currentSessionID)
  ) {
    state.currentSessionID = null;
  }

  if (!state.currentSessionID && state.sessions.length > 0) {
    state.currentSessionID = state.sessions[0].id;
  }

  renderSessions();
  await loadAndShowMessages();
}

async function restartRuntime() {
  await apiRestartRuntime();
  await refreshAll();
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
  if (event.target === elements.knowledgeModal) closeKnowledgeModal();
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
  if (event.target === elements.repoModal) closeRepoModal();
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
  if (event.target === elements.agentModal) closeAgentModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.agentModalOpen) closeAgentModal();
  if (event.key === "Escape" && state.knowledgeModalOpen) closeKnowledgeModal();
  if (event.key === "Escape" && state.repoModalOpen) closeRepoModal();
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
  if (file) {
    await uploadSkillZip(file);
    renderSkills();
  }
});

elements.mcpFile.addEventListener("change", async () => {
  const [file] = elements.mcpFile.files;
  elements.mcpFile.value = "";
  if (file) {
    await uploadMcpDocument(file);
    renderMcpDocuments();
  }
});

bindDropzone(elements.skillDropzone);
bindDropzone(elements.mcpDropzone);

elements.skillDropzone.addEventListener("drop", async (event) => {
  const [file] = event.dataTransfer.files;
  if (file) {
    await uploadSkillZip(file);
    renderSkills();
  }
});

elements.mcpDropzone.addEventListener("drop", async (event) => {
  const [file] = event.dataTransfer.files;
  if (file) {
    await uploadMcpDocument(file);
    renderMcpDocuments();
  }
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

if (elements.uploadSkills) {
  elements.uploadSkills.addEventListener("click", () => {
    elements.marketplaceUploadFile.click();
  });
}
if (elements.uploadMcp) {
  elements.uploadMcp.addEventListener("click", () => {
    elements.marketplaceUploadFile.click();
  });
}
if (elements.uploadAgents) {
  elements.uploadAgents.addEventListener("click", () => {
    elements.marketplaceUploadFile.click();
  });
}
if (elements.uploadKnowledge) {
  elements.uploadKnowledge.addEventListener("click", () => {
    elements.marketplaceUploadFile.click();
  });
}

if (elements.marketplaceUploadFile) {
  elements.marketplaceUploadFile.addEventListener("change", async () => {
    const file = elements.marketplaceUploadFile.files[0];
    if (!file) return;
    try {
      const res = await fetch("/api/marketplace/upload", {
        method: "POST",
        headers: { "x-file-name": encodeURIComponent(file.name) },
        body: file,
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || payload.error || "Upload failed");
      alert(`Upload successful! Bundle ID: ${payload.entry?.id || "unknown"}`);
      elements.marketplaceUploadFile.value = "";
      refreshAll();
    } catch (error) {
      alert(`Upload failed: ${error.message}`);
      elements.marketplaceUploadFile.value = "";
    }
  });
}

if (elements.marketplaceArchive) {
  elements.marketplaceArchive.addEventListener("click", async () => {
    const btn = elements.marketplaceArchive;
    const originalText = btn.textContent;
    btn.textContent = "归档中…";
    btn.disabled = true;
    try {
      const res = await fetch("/api/marketplace/snapshot", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || payload.error || "Archive failed");
      btn.textContent = "归档完成";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    } catch (error) {
      alert(`归档失败: ${error.message}`);
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
}

await refreshAll();
