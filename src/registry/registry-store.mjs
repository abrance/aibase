import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const DEFAULT_INDEX = {
  schemaVersion: 1,
  updatedAt: null,
  bundles: [],
};

export async function ensureRegistryRoot(registryRoot) {
  await mkdir(resolveRegistryRootDir(registryRoot), { recursive: true });
}

export async function readRegistryIndex(registryRoot) {
  const indexPath = resolveRegistryIndexPath(registryRoot);

  try {
    const raw = await readFile(indexPath, "utf8");
    return normalizeRegistryIndex(JSON.parse(raw));
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(DEFAULT_INDEX);
    throw error;
  }
}

export async function writeRegistryIndex(registryRoot, index) {
  const normalized = normalizeRegistryIndex(index);
  const indexPath = resolveRegistryIndexPath(registryRoot);
  await ensureRegistryRoot(registryRoot);

  const tempPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(tempPath, indexPath);
}

export async function upsertRegistryBundle(registryRoot, bundle) {
  const index = await readRegistryIndex(registryRoot);
  const nextBundle = normalizeRegistryBundle(bundle);
  const bundles = index.bundles.filter((item) => item.id !== nextBundle.id);
  bundles.push(nextBundle);

  await writeRegistryIndex(registryRoot, {
    ...index,
    bundles,
  });
}

function normalizeRegistryIndex(value) {
  return {
    schemaVersion: value?.schemaVersion ?? DEFAULT_INDEX.schemaVersion,
    updatedAt: value?.updatedAt ?? null,
    bundles: Array.isArray(value?.bundles) ? value.bundles.map(normalizeRegistryBundle) : [],
  };
}

function normalizeRegistryBundle(bundle) {
  const normalized = {
    ...bundle,
  };

  if (bundle && Object.hasOwn(bundle, "metadata")) {
    normalized.metadata = normalizeObject(bundle.metadata);
  }

  return normalized;
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

function resolveRegistryRootDir(registryRoot) {
  return join(resolve(registryRoot), "registry");
}

function resolveRegistryIndexPath(registryRoot) {
  return join(resolveRegistryRootDir(registryRoot), "index.json");
}
