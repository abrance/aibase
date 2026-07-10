import test from "node:test";
import assert from "node:assert/strict";
import { buildPromptRequestBody, prependKnowledgeReferences } from "../src/opencode-request.mjs";

test("converts string modelId to { providerID, modelID } object", () => {
  const payload = buildPromptRequestBody({
    text: "hello",
    model: "opencode/deepseek-v4-flash-free",
  });

  assert.deepEqual(payload, {
    agent: undefined,
    model: { providerID: "opencode", modelID: "deepseek-v4-flash-free" },
    system: undefined,
    parts: [
      {
        type: "text",
        text: "hello",
      },
    ],
  });
});

test("preserves valid { providerID, modelID } object unchanged", () => {
  const model = { providerID: "opencode", modelID: "deepseek-v4" };
  const payload = buildPromptRequestBody({
    text: "hello",
    model,
  });

  assert.deepEqual(payload, {
    agent: undefined,
    model,
    system: undefined,
    parts: [
      {
        type: "text",
        text: "hello",
      },
    ],
  });
});

test("omits invalid modelId strings (no slash, empty) from payload", () => {
  const payload1 = buildPromptRequestBody({ text: "hello", model: "no-slash" });
  const payload2 = buildPromptRequestBody({ text: "hello", model: "" });
  const payload3 = buildPromptRequestBody({ text: "hello", model: undefined });

  assert.equal(payload1.model, undefined);
  assert.equal(payload2.model, undefined);
  assert.equal(payload3.model, undefined);
});

test("prependKnowledgeReferences leaves text unchanged when no references are selected", () => {
  const result = prependKnowledgeReferences("hello", []);
  assert.equal(result, "hello");
});

test("prependKnowledgeReferences prepends a folder and a file reference in order", () => {
  const result = prependKnowledgeReferences("hello", [
    { type: "folder", path: "runbook" },
    { type: "file", path: "runbook/alarms.md" },
  ]);

  assert.equal(result, "@knowledge/runbook\n@knowledge/runbook/alarms.md\n\nhello");
});

test("prependKnowledgeReferences deduplicates repeated references", () => {
  const result = prependKnowledgeReferences("hello", [
    { type: "file", path: "runbook/alarms.md" },
    { type: "file", path: "runbook/alarms.md" },
  ]);

  assert.equal(result, "@knowledge/runbook/alarms.md\n\nhello");
});
