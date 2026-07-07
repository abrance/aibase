#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAuthHeaders } from "./auth-provider.mjs";
import { readMcpDocuments } from "./openapi-docs.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "../..");
const mcpRoot = resolve(process.env.AIBASE_MCP_DIR ?? `${projectRoot}/mcp`);

let inputBuffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  readFrames().catch((error) => {
    log(error);
  });
});

process.stdin.on("error", log);

async function readFrames() {
  while (true) {
    const headerEnd = inputBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = inputBuffer.slice(0, headerEnd).toString("utf8");
    const length = Number(header.match(/content-length:\s*(\d+)/i)?.[1] ?? 0);
    if (!length) {
      inputBuffer = inputBuffer.slice(headerEnd + 4);
      continue;
    }

    const frameEnd = headerEnd + 4 + length;
    if (inputBuffer.length < frameEnd) return;

    const body = inputBuffer.slice(headerEnd + 4, frameEnd).toString("utf8");
    inputBuffer = inputBuffer.slice(frameEnd);
    await handleMessage(JSON.parse(body));
  }
}

async function handleMessage(message) {
  if (!message?.method) return;

  try {
    switch (message.method) {
      case "initialize":
        return sendResult(message.id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "aibase-openapi",
            version: "0.1.0",
          },
        });

      case "notifications/initialized":
        return;

      case "tools/list":
        return sendResult(message.id, {
          tools: (await listTools()).map((tool) => ({
            name: tool.name,
            description: `${tool.title}\n${tool.description}\n${tool.method} ${tool.url}`,
            inputSchema: tool.inputSchema,
          })),
        });

      case "tools/call":
        return sendResult(message.id, await callTool(message.params?.name, message.params?.arguments ?? {}));

      case "resources/list":
      case "prompts/list":
        return sendResult(message.id, { resources: [], prompts: [] });

      default:
        return sendError(message.id, -32601, `Unsupported method: ${message.method}`);
    }
  } catch (error) {
    return sendError(message.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

async function listTools() {
  const documents = await readMcpDocuments(mcpRoot);
  return documents.flatMap((document) => document.tools);
}

async function callTool(name, args) {
  const tool = (await listTools()).find((item) => item.name === name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown Aibase OpenAPI tool: ${name}` }],
    };
  }

  const request = {
    method: tool.method || "POST",
    headers: buildHeaders(),
  };
  if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
    request.body = JSON.stringify(args ?? {});
  }

  const response = await fetch(tool.url, request);
  const text = await response.text();
  const payload = parseResponse(text);

  return {
    isError: !response.ok,
    content: [{
      type: "text",
      text: JSON.stringify({
        ok: response.ok,
        status: response.status,
        url: tool.url,
        data: payload,
      }, null, 2),
    }],
  };
}

function buildHeaders() {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
  });

  const authHeaders = buildAuthHeaders();
  for (const [key, value] of authHeaders.entries()) {
    headers.set(key, value);
  }

  return headers;
}

function parseResponse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sendResult(id, result) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  if (id === undefined || id === null) return;
  send({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function log(error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
}
