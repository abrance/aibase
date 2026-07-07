import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, normalize, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureRegistryRoot, readRegistryIndex, upsertRegistryBundle } from "./registry-store.mjs";

const execFileAsync = promisify(execFile);
const bundleRestartTypes = new Set(["skill", "mcp", "agent"]);

export async function readBundleManifest(bufferOrPath) {
  const zipPath = await ensureZipPath(bufferOrPath);
  const { stdout } = await execFileAsync("unzip", ["-p", zipPath, "bundle.json"]);
  return JSON.parse(stdout);
}

export function validateBundleManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("bundle manifest must be an object");
  }

  if (manifest.schemaVersion !== "1") {
    throw new Error("bundle manifest schemaVersion must be 1");
  }
  if (!manifest.id) throw new Error("bundle manifest id is required");
  if (!Array.isArray(manifest.items)) throw new Error("bundle manifest items are required");

  for (const item of manifest.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("bundle manifest items must be objects");
    }
    if (!item.id) throw new Error("bundle manifest item id is required");
    if (!item.type) throw new Error("bundle manifest item type is required");
    if (!item.source) throw new Error("bundle manifest item source is required");
    if (!item.target) throw new Error("bundle manifest item target is required");
    assertSafeBundleSource(item.source);
  }

  return manifest;
}

export function buildIndexEntryFromBundle(manifest, archiveName) {
  validateBundleManifest(manifest);

  return {
    id: manifest.id,
    name: manifest.name ?? manifest.id,
    version: manifest.version ?? null,
    description: manifest.description ?? null,
    author: manifest.author ?? null,
    tags: Array.isArray(manifest.tags) ? [...manifest.tags] : [],
    icon: manifest.icon ?? null,
    maturity: manifest.maturity ?? null,
    file: archiveName,
    itemCount: manifest.items.length,
    items: manifest.items.map((item) => ({
      id: item.id,
      type: item.type,
      target: item.target,
    })),
  };
}

export async function uploadBundleToRegistry(registryRoot, archive, fileName, options = {}) {
  const manifest = validateBundleManifest(await readBundleManifest(archive));
  const archiveName = `${manifest.id}.zip`;
  const archivePath = join(registryRoot, "registry", "bundles", archiveName);
  const entry = buildIndexEntryFromBundle(manifest, `bundles/${archiveName}`);

  await ensureRegistryRoot(registryRoot);
  await mkdir(join(registryRoot, "registry", "bundles"), { recursive: true });
  await writeFile(archivePath, archive);
  await upsertRegistryBundle(registryRoot, entry);

  return {
    fileName: basename(fileName || archiveName),
    entry,
  };
}

export async function readMarketplaceIndex(registryRoot) {
  return readRegistryIndex(registryRoot);
}

export async function installBundleById(bundleId, options = {}) {
  const registryRoot = options.registryRoot;
  if (!registryRoot) {
    throw new Error("registryRoot is required");
  }

  const index = await readMarketplaceIndex(registryRoot);
  const bundleEntry = index.bundles.find((entry) => entry.id === bundleId);
  if (!bundleEntry) {
    const error = new Error(`Bundle \"${bundleId}\" not found.`);
    error.code = "BUNDLE_NOT_FOUND";
    throw error;
  }

  const archivePath = resolveBundleArchivePath(registryRoot, bundleEntry.file);
  const manifest = validateBundleManifest(await readBundleManifest(archivePath));
  const bundleEntries = await listBundleEntryNames(archivePath);
  const installed = [];
  let shouldRestart = false;

  for (const item of manifest.items) {
    const install = options.installers?.[item.type];

    try {
      if (typeof install !== "function") {
        throw new Error(`No installer configured for bundle item type ${item.type}`);
      }

      const payload = await buildBundleItemPayload(archivePath, item, bundleEntries);
      await install(payload);
      installed.push({ itemId: item.id, type: item.type, target: item.target });
      if (bundleRestartTypes.has(item.type)) shouldRestart = true;
    } catch (error) {
      return {
        error: "bundle_install_failed",
        message: `Failed to install bundle item ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
        bundleId,
        failedItemId: item.id,
      };
    }
  }

  if (shouldRestart && typeof options.restartRuntime === "function") {
    await options.restartRuntime();
  }

  return {
    bundleId,
    installed,
  };
}

async function ensureZipPath(bufferOrPath) {
  if (typeof bufferOrPath === "string") return bufferOrPath;
  if (bufferOrPath instanceof Uint8Array || Buffer.isBuffer(bufferOrPath)) {
    const root = await mkdtemp(join(tmpdir(), "aibase-bundle-"));
    const zipPath = join(root, "bundle.zip");
    await writeFile(zipPath, bufferOrPath);
    return zipPath;
  }

  throw new Error("unsupported bundle input");
}

async function buildBundleItemPayload(zipPath, item, bundleEntries) {
  const source = normalizeBundleEntryPath(item.source);
  const fileEntry = bundleEntries.find((entry) => entry === source);

  if (fileEntry) {
    const buffer = await readBundleEntryBuffer(zipPath, fileEntry);
    return {
      itemId: item.id,
      type: item.type,
      target: item.target,
      source,
      sourceKind: "file",
      buffer,
      entries: [{ path: fileEntry, relativePath: basename(fileEntry), buffer }],
    };
  }

  const directoryPrefix = `${source.replace(/\/+$/, "")}/`;
  const matchedEntries = bundleEntries.filter((entry) => entry.startsWith(directoryPrefix));
  if (matchedEntries.length === 0) {
    throw new Error(`Bundle source not found: ${item.source}`);
  }

  return {
    itemId: item.id,
    type: item.type,
    target: item.target,
    source,
    sourceKind: "directory",
    entries: await Promise.all(matchedEntries.map(async (entry) => ({
      path: entry,
      relativePath: entry.slice(directoryPrefix.length),
      buffer: await readBundleEntryBuffer(zipPath, entry),
    }))),
  };
}

async function listBundleEntryNames(zipPath) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath]);
  return stdout
    .split("\n")
    .map((line) => normalizeBundleEntryPath(line.trim()))
    .filter((line) => line && !line.endsWith("/"));
}

async function readBundleEntryBuffer(zipPath, entryPath) {
  const { stdout } = await execFileAsync("unzip", ["-p", zipPath, entryPath], {
    encoding: "buffer",
    maxBuffer: 50 * 1024 * 1024,
  });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

function normalizeBundleEntryPath(path) {
  return String(path ?? "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\//, "");
}

function resolveBundleArchivePath(registryRoot, file) {
  const registryDirectory = resolve(registryRoot, "registry");
  const archivePath = resolve(registryDirectory, file);
  if (!archivePath.startsWith(`${registryDirectory}/`) && archivePath !== registryDirectory) {
    throw new Error("Bundle archive path is outside registry root");
  }
  return archivePath;
}

function assertSafeBundleSource(source) {
  if (typeof source !== "string" || source.length === 0) {
    throw new Error("bundle item source must be a string");
  }

  const normalized = normalize(source).replace(/^\.[/\\]/, "");
  if (
    source.startsWith("/") ||
    source.startsWith("\\") ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    normalized.includes("/../") ||
    normalized.includes("\\..\\") ||
    normalized.includes("../") ||
    normalized.includes("..\\")
  ) {
    throw new Error("bundle item source path is unsafe");
  }
}


