import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createKnowledgeFile,
  createKnowledgeFolder,
  deleteKnowledgeFile,
  deleteKnowledgeFolder,
  listKnowledgeTree,
  readKnowledgeFile,
  renameKnowledgeFile,
  renameKnowledgeFolder,
  updateKnowledgeFile,
} from "../src/knowledge/knowledge-manager.mjs";

async function createRoot() {
  return mkdtemp(join(tmpdir(), "aibase-knowledge-"));
}

test("listKnowledgeTree returns empty arrays for a new root", async () => {
  const root = await createRoot();

  const tree = await listKnowledgeTree(root);

  assert.deepEqual(tree, {
    folders: [],
    files: [],
  });
});

test("createKnowledgeFolder creates nested folders under the root", async () => {
  const root = await createRoot();

  await createKnowledgeFolder(root, "runbook/alerts");

  assert.equal(existsSync(join(root, "runbook")), true);
  assert.equal(existsSync(join(root, "runbook", "alerts")), true);
});

test("createKnowledgeFile writes allowed files and readKnowledgeFile returns content", async () => {
  const root = await createRoot();

  await createKnowledgeFile(root, "runbook/alarms.md", "hello knowledge");

  const fileContent = await readKnowledgeFile(root, "runbook/alarms.md");
  const raw = await readFile(join(root, "runbook", "alarms.md"), "utf8");

  assert.equal(fileContent, "hello knowledge");
  assert.equal(raw, "hello knowledge");
});

test("updateKnowledgeFile replaces file content", async () => {
  const root = await createRoot();

  await createKnowledgeFile(root, "runbook/alarms.md", "old");
  await updateKnowledgeFile(root, "runbook/alarms.md", "new");

  const raw = await readFile(join(root, "runbook", "alarms.md"), "utf8");
  assert.equal(raw, "new");
});

test("renameKnowledgeFolder renames a folder tree inside the root", async () => {
  const root = await createRoot();

  await createKnowledgeFile(root, "runbook/alarms.md", "content");
  await renameKnowledgeFolder(root, "runbook", "ops-runbook");

  assert.equal(existsSync(join(root, "runbook")), false);
  assert.equal(existsSync(join(root, "ops-runbook", "alarms.md")), true);
});

test("renameKnowledgeFile renames a file inside the same root", async () => {
  const root = await createRoot();

  await createKnowledgeFile(root, "runbook/alarms.md", "content");
  await renameKnowledgeFile(root, "runbook/alarms.md", "runbook/alarms-v2.md");

  assert.equal(existsSync(join(root, "runbook", "alarms.md")), false);
  assert.equal(existsSync(join(root, "runbook", "alarms-v2.md")), true);
});

test("deleteKnowledgeFile removes the file only", async () => {
  const root = await createRoot();

  await createKnowledgeFile(root, "runbook/alarms.md", "content");
  await deleteKnowledgeFile(root, "runbook/alarms.md");

  assert.equal(existsSync(join(root, "runbook", "alarms.md")), false);
  assert.equal(existsSync(join(root, "runbook")), true);
});

test("deleteKnowledgeFolder removes the full subtree", async () => {
  const root = await createRoot();

  await createKnowledgeFile(root, "runbook/alerts/alarms.md", "content");
  await deleteKnowledgeFolder(root, "runbook");

  assert.equal(existsSync(join(root, "runbook")), false);
});

test("rejects traversal outside knowledge root", async () => {
  const root = await createRoot();

  await assert.rejects(
    () => createKnowledgeFile(root, "../escape.md", "x"),
    /outside knowledge root|invalid/i,
  );
});

test("rejects unsupported extensions", async () => {
  const root = await createRoot();

  await assert.rejects(
    () => createKnowledgeFile(root, "runbook/alarms.pdf", "x"),
    /supported|extension/i,
  );
});

test("listKnowledgeTree returns nested folder and file metadata", async () => {
  const root = await createRoot();
  await mkdir(join(root, "runbook"), { recursive: true });
  await writeFile(join(root, "runbook", "alarms.md"), "alarm");
  await writeFile(join(root, "runbook", "faq.txt"), "faq");

  const tree = await listKnowledgeTree(root);

  assert.deepEqual(tree, {
    folders: [
      {
        name: "runbook",
        path: "runbook",
        folders: [],
        files: [
          { name: "alarms.md", path: "runbook/alarms.md", ext: ".md" },
          { name: "faq.txt", path: "runbook/faq.txt", ext: ".txt" },
        ],
      },
    ],
    files: [],
  });
});
