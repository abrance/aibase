import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";

const supportedKnowledgeExtensions = new Set([".md", ".txt", ".json"]);

export async function listKnowledgeTree(knowledgeRoot) {
  await mkdir(knowledgeRoot, { recursive: true });
  return readDirectoryNode(knowledgeRoot, knowledgeRoot, "");
}

export async function readKnowledgeFile(knowledgeRoot, relativePath) {
  const path = resolveKnowledgeFilePath(knowledgeRoot, relativePath);
  return readFile(path, "utf8");
}

export async function createKnowledgeFolder(knowledgeRoot, relativePath) {
  const path = resolveKnowledgeFolderPath(knowledgeRoot, relativePath);
  await mkdir(path, { recursive: true });
}

export async function renameKnowledgeFolder(knowledgeRoot, from, to) {
  const fromPath = resolveKnowledgeFolderPath(knowledgeRoot, from);
  const toPath = resolveKnowledgeFolderPath(knowledgeRoot, to);
  await mkdir(dirname(toPath), { recursive: true });
  await rename(fromPath, toPath);
}

export async function deleteKnowledgeFolder(knowledgeRoot, relativePath) {
  const path = resolveKnowledgeFolderPath(knowledgeRoot, relativePath);
  await rm(path, { recursive: true, force: true });
}

export async function createKnowledgeFile(knowledgeRoot, relativePath, content) {
  const path = resolveKnowledgeFilePath(knowledgeRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, String(content ?? ""), "utf8");
}

export async function updateKnowledgeFile(knowledgeRoot, relativePath, content) {
  const path = resolveKnowledgeFilePath(knowledgeRoot, relativePath);
  await writeFile(path, String(content ?? ""), "utf8");
}

export async function renameKnowledgeFile(knowledgeRoot, from, to) {
  const fromPath = resolveKnowledgeFilePath(knowledgeRoot, from);
  const toPath = resolveKnowledgeFilePath(knowledgeRoot, to);
  await mkdir(dirname(toPath), { recursive: true });
  await rename(fromPath, toPath);
}

export async function deleteKnowledgeFile(knowledgeRoot, relativePath) {
  const path = resolveKnowledgeFilePath(knowledgeRoot, relativePath);
  await rm(path, { force: true });
}

async function readDirectoryNode(knowledgeRoot, absolutePath, relativePath) {
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const folders = [];
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const childAbsolutePath = join(absolutePath, entry.name);
    const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const subtree = await readDirectoryNode(knowledgeRoot, childAbsolutePath, childRelativePath);
      folders.push({
        name: entry.name,
        path: childRelativePath,
        folders: subtree.folders,
        files: subtree.files,
      });
      continue;
    }

    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (!supportedKnowledgeExtensions.has(extension)) continue;
    files.push({
      name: entry.name,
      path: childRelativePath,
      ext: extension,
    });
  }

  if (relativePath === "") {
    return { folders, files };
  }

  return { folders, files };
}

function resolveKnowledgeFolderPath(knowledgeRoot, relativePath) {
  const normalized = normalizeKnowledgePath(relativePath, false);
  const absoluteRoot = resolve(knowledgeRoot);
  const absolutePath = resolve(absoluteRoot, normalized);
  assertInsideKnowledgeRoot(absoluteRoot, absolutePath);
  return absolutePath;
}

function resolveKnowledgeFilePath(knowledgeRoot, relativePath) {
  const normalized = normalizeKnowledgePath(relativePath, true);
  const absoluteRoot = resolve(knowledgeRoot);
  const absolutePath = resolve(absoluteRoot, normalized);
  assertInsideKnowledgeRoot(absoluteRoot, absolutePath);
  assertSupportedKnowledgeExtension(absolutePath);
  return absolutePath;
}

function normalizeKnowledgePath(relativePath, requireLeaf) {
  const raw = String(relativePath ?? "").replaceAll("\\", "/").trim();
  const normalized = normalize(raw).replaceAll("\\", "/");

  if (!normalized || normalized === ".") {
    throw new Error("Invalid knowledge path.");
  }

  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) {
    throw new Error("Knowledge path is outside knowledge root.");
  }

  if (requireLeaf) {
    const leaf = normalized.split("/").pop() || "";
    if (!leaf || leaf === "." || leaf === "..") {
      throw new Error("Invalid knowledge file path.");
    }
  }

  return normalized;
}

function assertInsideKnowledgeRoot(root, absolutePath) {
  const rel = relative(root, absolutePath).replaceAll("\\", "/");
  if (rel === "") return;
  if (rel === ".." || rel.startsWith("../") || resolve(root, rel) !== absolutePath) {
    throw new Error("Knowledge path is outside knowledge root.");
  }
}

function assertSupportedKnowledgeExtension(path) {
  const extension = extname(path).toLowerCase();
  if (!supportedKnowledgeExtensions.has(extension)) {
    throw new Error("Only .md, .txt, and .json knowledge files are supported.");
  }
}

export function isSupportedKnowledgeFile(path) {
  return supportedKnowledgeExtensions.has(extname(path).toLowerCase());
}

export async function ensureKnowledgeRoot(knowledgeRoot) {
  if (!existsSync(knowledgeRoot)) {
    await mkdir(knowledgeRoot, { recursive: true });
    return;
  }

  const info = await stat(knowledgeRoot);
  if (!info.isDirectory()) {
    throw new Error("Knowledge root exists but is not a directory.");
  }
}
