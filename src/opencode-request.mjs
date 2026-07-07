export function buildPromptRequestBody({ text, model, agent, system }) {
  return {
    agent: agent || undefined,
    model: normalizePromptModel(model),
    system: system || undefined,
    parts: [{ type: "text", text }],
  };
}

export function prependKnowledgeReferences(text, references = []) {
  const normalizedText = String(text ?? "").trim();
  const lines = [];
  const seen = new Set();

  for (const reference of references) {
    const relativePath = String(reference?.path || "").trim().replace(/^\/+/, "");
    if (!relativePath) continue;
    const line = `@knowledge/${relativePath}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }

  if (lines.length === 0) return normalizedText;
  if (!normalizedText) return lines.join("\n");
  return `${lines.join("\n")}\n\n${normalizedText}`;
}

function normalizePromptModel(model) {
  if (!model) return undefined;

  if (Array.isArray(model) || typeof model !== "object") {
    const parts = typeof model === "string" ? model.split("/", 2) : null;
    if (parts && parts[0] && parts[1]) {
      return { providerID: parts[0], modelID: parts[1] };
    }
    return undefined;
  }

  return model;
}
