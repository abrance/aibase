import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureRegistryRoot,
  readRegistryIndex,
  upsertRegistryBundle,
  writeRegistryIndex,
} from "../src/registry/registry-store.mjs";

async function createRoot() {
  return mkdtemp(join(tmpdir(), "aibase-registry-"));
}

test("readRegistryIndex returns the default empty catalog when missing", async () => {
  const root = await createRoot();

  const index = await readRegistryIndex(root);

  assert.deepEqual(index, {
    schemaVersion: 1,
    updatedAt: null,
    bundles: [],
  });
});

test("upsertRegistryBundle replaces an existing bundle with the same id", async () => {
  const root = await createRoot();

  await upsertRegistryBundle(root, {
    id: "bundle-a",
    version: "1.0.0",
    metadata: { name: "first" },
  });

  await upsertRegistryBundle(root, {
    id: "bundle-a",
    version: "2.0.0",
    metadata: { name: "second" },
  });

  const index = await readRegistryIndex(root);

  assert.deepEqual(index.bundles, [
    {
      id: "bundle-a",
      version: "2.0.0",
      metadata: { name: "second" },
    },
  ]);
});

test("writeRegistryIndex persists through registry root helpers", async () => {
  const root = await createRoot();

  await ensureRegistryRoot(root);
  await writeRegistryIndex(root, {
    schemaVersion: 1,
    updatedAt: "2026-06-13T00:00:00.000Z",
    bundles: [],
  });

  const parsed = JSON.parse(await readFile(join(root, "registry", "index.json"), "utf8"));
  assert.deepEqual(parsed, {
    schemaVersion: 1,
    updatedAt: "2026-06-13T00:00:00.000Z",
    bundles: [],
  });
});
