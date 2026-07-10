export function extractModelsFromProviders(payload) {
  const providers = Array.isArray(payload?.all) ? payload.all : [];
  const defaults = payload?.default && typeof payload.default === "object" ? payload.default : {};
  const connected = new Set(Array.isArray(payload?.connected) ? payload.connected : []);
  const result = [];
  const seen = new Set();

  for (const provider of providers) {
    const providerId = String(provider?.id || "").trim();
    if (!providerId || !connected.has(providerId)) continue;

    const providerName = String(provider?.name || providerId || "").trim();
    const models = provider?.models && typeof provider.models === "object" ? provider.models : {};
    const defaultModelId = String(defaults[providerId] || "").trim();

    for (const [modelId, info] of Object.entries(models)) {
      const cleanModelId = String(modelId || "").trim();
      if (!cleanModelId) continue;

      const id = `${providerId}/${cleanModelId}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const modelName = String(info?.name || cleanModelId).trim();
      result.push({
        id,
        label: `${providerName} / ${modelName}`,
        default: cleanModelId === defaultModelId,
      });
    }
  }

  return result;
}
