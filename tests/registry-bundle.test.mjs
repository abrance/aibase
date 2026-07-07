import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import * as registryBundleModule from "../src/registry/registry-bundle.mjs";
import {
  buildIndexEntryFromBundle,
  readBundleManifest,
  uploadBundleToRegistry,
  validateBundleManifest,
} from "../src/registry/registry-bundle.mjs";

import { readRegistryIndex } from "../src/registry/registry-store.mjs";

const execFileAsync = promisify(execFile);

async function createTempDir() {
  return mkdtemp(join(tmpdir(), "aibase-bundle-"));
}

async function createBundleZip(manifest) {
  const root = await createTempDir();
  const bundleDir = join(root, "bundle");
  const zipPath = join(root, "bundle.zip");

  await execFileAsync("mkdir", ["-p", bundleDir]);
  await writeFile(join(bundleDir, "bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await execFileAsync("zip", ["-q", "-r", zipPath, "."], { cwd: bundleDir });

  return zipPath;
}

async function createBundleArchive(manifest, files = {}) {
  const root = await createTempDir();
  const bundleDir = join(root, "bundle");
  const zipPath = join(root, `${manifest.id}.zip`);

  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, "bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(bundleDir, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  await execFileAsync("zip", ["-q", "-r", zipPath, "."], { cwd: bundleDir });
  return zipPath;
}

async function seedRegistryBundle(root, manifest, files = {}) {
  const zipPath = await createBundleArchive(manifest, files);
  await uploadBundleToRegistry(root, await readFile(zipPath), `${manifest.id}.zip`);
}

test("readBundleManifest reads bundle.json from zip", async () => {
  const zipPath = await createBundleZip({
    schemaVersion: "1",
    id: "bundle-a",
    name: "Bundle A",
    items: [],
  });

  const manifest = await readBundleManifest(zipPath);

  assert.deepEqual(manifest, {
    schemaVersion: "1",
    id: "bundle-a",
    name: "Bundle A",
    items: [],
  });
});

test("validateBundleManifest rejects missing items", () => {
  assert.throws(
    () => validateBundleManifest({
      schemaVersion: "1",
      id: "bundle-a",
      name: "Bundle A",
    }),
    /items/i,
  );
});

test("validateBundleManifest rejects unsafe source paths", () => {
  assert.throws(
    () => validateBundleManifest({
      schemaVersion: "1",
      id: "bundle-a",
      name: "Bundle A",
      items: [
        {
          id: "item-a",
          type: "skill",
          source: "../outside.zip",
          target: "skill-a",
        },
      ],
    }),
    /source/i,
  );
});

test("buildIndexEntryFromBundle projects manifest fields into an index entry", () => {
  const entry = buildIndexEntryFromBundle(
    {
      schemaVersion: "1",
      id: "bundle-a",
      name: "Bundle A",
      version: "1.2.3",
      description: "Bundle description",
      author: "Aibase",
      tags: ["alpha", "beta"],
      icon: "https://example.com/icon.png",
      maturity: "stable",
      items: [
        { id: "skill-a", type: "skill", source: "skills/skill-a.zip", target: "skill-a" },
        { id: "mcp-a", type: "mcp", source: "mcp/mcp-a.md", target: "mcp-a.md" },
      ],
    },
    "bundle-a.zip",
  );

  assert.deepEqual(entry, {
    id: "bundle-a",
    name: "Bundle A",
    version: "1.2.3",
    description: "Bundle description",
    author: "Aibase",
    tags: ["alpha", "beta"],
    icon: "https://example.com/icon.png",
    maturity: "stable",
    file: "bundle-a.zip",
    itemCount: 2,
    items: [
      { id: "skill-a", type: "skill", target: "skill-a" },
      { id: "mcp-a", type: "mcp", target: "mcp-a.md" },
    ],
  });
});

test("uploadBundleToRegistry stores the zip under registry/bundles and upserts the index entry", async () => {
  const root = await createTempDir();
  const firstManifest = {
    schemaVersion: "1",
    id: "bundle-a",
    name: "Bundle A",
    version: "1.0.0",
    items: [
      { id: "skill-a", type: "skill", source: "skills/skill-a.zip", target: "skill-a" },
    ],
  };
  const secondManifest = {
    schemaVersion: "1",
    id: "bundle-a",
    name: "Bundle A",
    version: "2.0.0",
    items: [
      { id: "skill-a", type: "skill", source: "skills/skill-a.zip", target: "skill-a" },
    ],
  };

  await uploadBundleToRegistry(root, await readFile(await createBundleZip(firstManifest)), "bundle-a-first.zip");
  const result = await uploadBundleToRegistry(root, await readFile(await createBundleZip(secondManifest)), "bundle-a-second.zip");

  const storedManifest = await readBundleManifest(join(root, "registry", "bundles", "bundle-a.zip"));
  const index = await readRegistryIndex(root);

  assert.deepEqual(storedManifest, secondManifest);
  assert.equal(index.bundles.length, 1);
  assert.deepEqual(index.bundles[0], result.entry);
  assert.equal(index.bundles[0].file, "bundles/bundle-a.zip");
});

test("installBundleById returns bundleId and installed targets", async () => {
  const root = await createTempDir();
  const installBundleById = registryBundleModule.installBundleById ?? (async () => ({ missing: true }));
  const manifest = {
    schemaVersion: "1",
    id: "bundle-install-success",
    name: "Bundle Install Success",
    items: [
      { id: "skill-a", type: "skill", source: "assets/skill-a.zip", target: "skill-a" },
      { id: "knowledge-a", type: "knowledge", source: "knowledge/guide.md", target: "runbook/guide.md" },
    ],
  };

  await seedRegistryBundle(root, manifest, {
    "assets/skill-a.zip": Buffer.from("skill archive"),
    "knowledge/guide.md": "# guide\n",
  });

  const calls = [];
  const result = await installBundleById("bundle-install-success", {
    registryRoot: root,
    installers: {
      skill: async (payload) => {
        calls.push({ type: "skill", target: payload.target, body: payload.buffer.toString("utf8") });
      },
      knowledge: async (payload) => {
        calls.push({
          type: "knowledge",
          target: payload.target,
          sourceKind: payload.sourceKind,
          body: payload.entries[0].buffer.toString("utf8"),
        });
      },
    },
    restartRuntime: async () => {
      calls.push({ type: "restart" });
    },
  });

  assert.deepEqual(result, {
    bundleId: "bundle-install-success",
    installed: [
      { itemId: "skill-a", type: "skill", target: "skill-a" },
      { itemId: "knowledge-a", type: "knowledge", target: "runbook/guide.md" },
    ],
  });
  assert.deepEqual(calls, [
    { type: "skill", target: "skill-a", body: "skill archive" },
    { type: "knowledge", target: "runbook/guide.md", sourceKind: "file", body: "# guide\n" },
    { type: "restart" },
  ]);
});

test("installBundleById returns failedItemId on item install failure", async () => {
  const root = await createTempDir();
  const installBundleById = registryBundleModule.installBundleById ?? (async () => ({ missing: true }));
  const manifest = {
    schemaVersion: "1",
    id: "bundle-install-failure",
    name: "Bundle Install Failure",
    items: [
      { id: "skill-a", type: "skill", source: "assets/skill-a.zip", target: "skill-a" },
      { id: "mcp-a", type: "mcp", source: "mcp/api.md", target: "api.md" },
    ],
  };

  await seedRegistryBundle(root, manifest, {
    "assets/skill-a.zip": Buffer.from("skill archive"),
    "mcp/api.md": "# MCP\n",
  });

  let restartCount = 0;
  const result = await installBundleById("bundle-install-failure", {
    registryRoot: root,
    installers: {
      skill: async () => {},
      mcp: async () => {
        throw new Error("bad mcp payload");
      },
    },
    restartRuntime: async () => {
      restartCount += 1;
    },
  });

  assert.deepEqual(result, {
    error: "bundle_install_failed",
    message: "Failed to install bundle item mcp-a: bad mcp payload",
    bundleId: "bundle-install-failure",
    failedItemId: "mcp-a",
  });
  assert.equal(restartCount, 0);
});

test("only knowledge bundles do not request restart", async () => {
  const root = await createTempDir();
  const installBundleById = registryBundleModule.installBundleById ?? (async () => ({ missing: true }));
  const manifest = {
    schemaVersion: "1",
    id: "bundle-knowledge-only",
    name: "Knowledge Only",
    items: [
      { id: "knowledge-a", type: "knowledge", source: "knowledge/guide.md", target: "runbook/guide.md" },
    ],
  };

  await seedRegistryBundle(root, manifest, {
    "knowledge/guide.md": "# guide\n",
  });

  let restartCount = 0;
  const result = await installBundleById("bundle-knowledge-only", {
    registryRoot: root,
    installers: {
      knowledge: async () => {},
    },
    restartRuntime: async () => {
      restartCount += 1;
    },
  });

  assert.deepEqual(result, {
    bundleId: "bundle-knowledge-only",
    installed: [
      { itemId: "knowledge-a", type: "knowledge", target: "runbook/guide.md" },
    ],
  });
  assert.equal(restartCount, 0);
});

test("bundles containing skill/mcp/agent require a single restart decision", async () => {
  const root = await createTempDir();
  const installBundleById = registryBundleModule.installBundleById ?? (async () => ({ missing: true }));
  const manifest = {
    schemaVersion: "1",
    id: "bundle-restart-once",
    name: "Restart Once",
    items: [
      { id: "skill-a", type: "skill", source: "assets/skill-a.zip", target: "skill-a" },
      { id: "mcp-a", type: "mcp", source: "mcp/api.md", target: "api.md" },
      { id: "agent-a", type: "agent", source: "agents/agent-a.json", target: "agent-a" },
      { id: "knowledge-a", type: "knowledge", source: "knowledge/guide.md", target: "runbook/guide.md" },
    ],
  };

  await seedRegistryBundle(root, manifest, {
    "assets/skill-a.zip": Buffer.from("skill archive"),
    "mcp/api.md": "# MCP\n",
    "agents/agent-a.json": JSON.stringify({ description: "agent" }),
    "knowledge/guide.md": "# guide\n",
  });

  let restartCount = 0;
  const installedTypes = [];
  const result = await installBundleById("bundle-restart-once", {
    registryRoot: root,
    installers: {
      skill: async () => installedTypes.push("skill"),
      mcp: async () => installedTypes.push("mcp"),
      agent: async () => installedTypes.push("agent"),
      knowledge: async () => installedTypes.push("knowledge"),
    },
    restartRuntime: async () => {
      restartCount += 1;
    },
  });

  assert.deepEqual(installedTypes, ["skill", "mcp", "agent", "knowledge"]);
  assert.equal(restartCount, 1);
  assert.equal(result.bundleId, "bundle-restart-once");
});

test("readMarketplaceIndex reads marketplace data from registry/index.json", async () => {
  const root = await createTempDir();
  const readMarketplaceIndex = registryBundleModule.readMarketplaceIndex ?? (async () => ({ bundles: [] }));
  await uploadBundleToRegistry(root, await readFile(await createBundleZip({
    schemaVersion: "1",
    id: "bundle-marketplace-list",
    name: "Marketplace List",
    items: [
      { id: "skill-a", type: "skill", source: "skills/skill-a.zip", target: "skill-a" },
    ],
  })), "bundle-marketplace-list.zip");

  const index = await readMarketplaceIndex(root);

  assert.deepEqual(index.bundles.map((bundle) => ({ id: bundle.id, file: bundle.file })), [
    { id: "bundle-marketplace-list", file: "bundles/bundle-marketplace-list.zip" },
  ]);
});
