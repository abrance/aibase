import test from "node:test";
import assert from "node:assert/strict";
import { extractModelsFromProviders } from "../public/model-options.js";

test("extractModelsFromProviders only returns models from connected providers", () => {
  const result = extractModelsFromProviders({
    all: [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-4o": { name: "GPT-4o" },
        },
      },
      {
        id: "deepseek",
        name: "DeepSeek",
        models: {
          "deepseek-chat": { name: "DeepSeek Chat" },
        },
      },
    ],
    default: {
      openai: "gpt-4o",
      deepseek: "deepseek-chat",
    },
    connected: ["deepseek"],
  });

  assert.deepEqual(result, [
    {
      id: "deepseek/deepseek-chat",
      label: "DeepSeek / DeepSeek Chat",
      default: true,
    },
  ]);
});

test("extractModelsFromProviders returns no models when connected provider list is absent", () => {
  const result = extractModelsFromProviders({
    all: [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-4o": { name: "GPT-4o" },
        },
      },
    ],
    default: {
      openai: "gpt-4o",
    },
  });

  assert.deepEqual(result, []);
});
