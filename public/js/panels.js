import { state } from "./state.js";
import { elements } from "./elements.js";
import { escapeHtml, formatTime } from "./utils.js";
import { extractModelsFromProviders } from "/model-options.js";
import { requestJson, installMarketplaceBundle } from "./api.js";

let _openAgentModal = null;
let _retryRepo = null;

export function setModalHelpers(openAgent, retry) {
  _openAgentModal = openAgent;
  _retryRepo = retry;
}

export function renderSkills(errorMessage) {
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

export function renderMcpDocuments(errorMessage) {
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
    const tools = (mcpDocument.tools || [])
      .slice(0, 3)
      .map((tool) => tool.name)
      .join(", ");
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

export function renderAgents(errorMessage) {
  elements.agents.innerHTML = "";
  elements.agentCount.textContent = String(state.agents.length);

  if (errorMessage) {
    const item = document.createElement("div");
    item.className = "skill";
    item.innerHTML = `<strong>Unavailable</strong><p>${escapeHtml(errorMessage)}</p>`;
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
    nameButton.innerHTML =
      `<strong>${escapeHtml(agent.displayName || agent.name)}</strong>` +
      `<span class="agent-name">${escapeHtml(agent.name)}</span>` +
      `<span class="agent-mode-badge">${escapeHtml(agent.mode || "subagent")}</span>` +
      (agent.description ? `<p class="agent-desc">${escapeHtml(agent.description)}</p>` : "");
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
      if (_openAgentModal) _openAgentModal(agent);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.title = "Delete";
    deleteBtn.className = "agent-delete";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!confirm(`Delete agent "${agent.displayName || agent.name}"?`)) return;
      try {
        const payload = await requestJson(`/api/agents/${encodeURIComponent(agent.name)}`, {
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

export function renderKnowledge(errorMessage) {
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

  const hasContent =
    state.knowledgeTree.files.length > 0 || state.knowledgeTree.folders.length > 0;
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

export function renderMarketplace(errorMessage) {
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

    let maturityHTML = "";
    if (bundle.maturity) {
      maturityHTML = `<span style="display:inline-block; border:1px solid var(--line); border-radius:4px; padding:1px 4px; font-size:9px; margin-left:6px; vertical-align:middle;">${escapeHtml(bundle.maturity)}</span>`;
    }

    info.innerHTML = `
      <strong>${escapeHtml(bundle.name || bundle.id)}${maturityHTML}</strong>
      <span>${escapeHtml(bundle.id)} (v${escapeHtml(bundle.version || "1.0.0")})</span>
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

export function renderRepos(errorMessage) {
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
        if (_retryRepo) await _retryRepo(repo.name);
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
        state.referencedKnowledge = state.referencedKnowledge.filter(
          (item) => !(item.type === "repo" && item.path === repo.name)
        );
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

export function renderRepoStatusChip(status, errorMessage) {
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
  refButton.addEventListener("click", () =>
    addKnowledgeReference({ type: "folder", path: folder.path })
  );
  info.append(refButton);

  const tools = document.createElement("div");
  tools.className = "knowledge-tools";
  tools.append(
    createInlineAction("引用", () =>
      addKnowledgeReference({ type: "folder", path: folder.path })
    ),
    createInlineAction("改名", () => {
      const { openKnowledgeModal } = window.__modals || {};
      if (openKnowledgeModal) openKnowledgeModal({ kind: "folder", mode: "rename", target: folder });
    }),
    createInlineAction("删", async () => {
      if (!confirm(`Delete folder "${folder.path}"?`)) return;
      const { deleteKnowledgeFolderEntry } = window.__modals || {};
      if (deleteKnowledgeFolderEntry) await deleteKnowledgeFolderEntry(folder.path);
    })
  );

  row.append(info, tools);
  article.append(row);

  const children = document.createElement("div");
  children.className = "knowledge-node-children";
  for (const childFolder of folder.folders || [])
    children.append(buildKnowledgeFolderNode(childFolder));
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
  refButton.addEventListener("click", () =>
    addKnowledgeReference({ type: "file", path: file.path })
  );
  info.append(refButton);

  const tools = document.createElement("div");
  tools.className = "knowledge-tools";
  tools.append(
    createInlineAction("引用", () =>
      addKnowledgeReference({ type: "file", path: file.path })
    ),
    createInlineAction("编辑", async () => {
      const payload = await requestJson(
        `/api/knowledge/file?path=${encodeURIComponent(file.path)}`
      );
      const { openKnowledgeModal } = window.__modals || {};
      if (openKnowledgeModal)
        openKnowledgeModal({
          kind: "file",
          mode: "edit",
          target: file,
          content: payload.content || "",
        });
    }),
    createInlineAction("删", async () => {
      if (!confirm(`Delete file "${file.path}"?`)) return;
      const { deleteKnowledgeFileEntry } = window.__modals || {};
      if (deleteKnowledgeFileEntry) await deleteKnowledgeFileEntry(file.path);
    })
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

export function addKnowledgeReference(reference) {
  const key = `${reference.type}:${reference.path}`;
  const exists = state.referencedKnowledge.some(
    (item) => `${item.type}:${item.path}` === key
  );
  if (exists) return;
  state.referencedKnowledge.push(reference);
  renderKnowledgeReferences();
}

export function renderKnowledgeReferences() {
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
      state.referencedKnowledge = state.referencedKnowledge.filter(
        (item) => !(item.type === reference.type && item.path === reference.path)
      );
      renderKnowledgeReferences();
    });

    tag.append(remove);
    elements.knowledgeReferenceTags.append(tag);
  }
}

export function renderModelPicker() {
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

export function renderModelOptions() {
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

export function insertSkillPrompt(skill) {
  const prefix = `Use the ${skill.name} skill for this request.\n`;
  const current = elements.prompt.value.trimStart();
  elements.prompt.value = current.startsWith(prefix) ? current : prefix + current;
  elements.prompt.focus();
}

export function insertMcpPrompt(document) {
  const prefix = `Use the ${document.name} MCP tools when this request needs KingEye OpenAPI data.\n`;
  const current = elements.prompt.value.trimStart();
  elements.prompt.value = current.startsWith(prefix) ? current : prefix + current;
  elements.prompt.focus();
}

export function insertAgentPrompt(agent) {
  const prefix = `Use the ${agent.name} agent for this request.\n`;
  const current = elements.prompt.value.trimStart();
  elements.prompt.value = current.startsWith(prefix) ? current : prefix + current;
  elements.prompt.focus();
}

export function prependKnowledgeReferences(text, references) {
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
