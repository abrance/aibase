import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export const supportedMcpDocumentExtensions = new Set([
  ".md",
  ".markdown",
]);

export function getMcpEnvironmentBaseURL(env = process.env) {
  return env.AIBASE_ENV_BASE_URL || "";
}

export async function readMcpDocuments(mcpRoot, env = process.env) {
  if (!existsSync(mcpRoot)) {
    return [];
  }

  const entries = await readdir(mcpRoot, { withFileTypes: true });
  const documents = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!supportedMcpDocumentExtensions.has(extname(entry.name).toLowerCase())) continue;

    const path = join(mcpRoot, entry.name);
    const content = await readFile(path, "utf8");
    documents.push(parseOpenApiDocument(content, entry.name, env));
  }

  return documents.sort((left, right) => left.name.localeCompare(right.name));
}

export async function installMcpDocument(mcpRoot, buffer, fileName, env = process.env) {
  const cleanName = sanitizeDocumentName(fileName);
  if (!supportedMcpDocumentExtensions.has(extname(cleanName).toLowerCase())) {
    throw new Error("Only Markdown MCP API documents are supported.");
  }

  await mkdir(mcpRoot, { recursive: true });
  const target = join(mcpRoot, cleanName);
  const overwritten = existsSync(target);

  const content = buffer.toString("utf8");
  const document = parseOpenApiDocument(content, cleanName, env);
  if (document.tools.length === 0) {
    throw new Error("MCP API document must contain at least one interface section.");
  }

  await writeFile(target, buffer);

  return {
    ...document,
    overwritten,
  };
}

export function parseOpenApiDocument(markdown, fileName, env = process.env) {
  const name = slug(fileName.replace(/\.(md|markdown)$/i, ""));
  const title = extractDocumentTitle(markdown) || name;
  const sections = splitInterfaceSections(markdown);
  const environmentBaseURL = getMcpEnvironmentBaseURL(env);
  const tools = sections
    .map((section) => parseInterfaceSection(section, environmentBaseURL))
    .filter(Boolean);

  return {
    name,
    fileName,
    displayName: title,
    description: extractDocumentDescription(markdown),
    environmentBaseURL,
    tools,
    apiCount: tools.length,
  };
}

export function resolveEndpointURL(rawURL, environmentBaseURL = "") {
  if (!rawURL || !environmentBaseURL) return rawURL;

  const source = new URL(rawURL);
  const base = new URL(environmentBaseURL);
  const basePath = normalizeBasePath(base.pathname);
  if (!basePath) {
    return `${base.origin}${source.pathname}${source.search}`;
  }

  return `${base.origin}${basePath}${source.pathname}${source.search}`;
}

function parseInterfaceSection(section, environmentBaseURL) {
  const interfaceName = extractAfterHeading(section.body, "接口名称").match(/`([^`]+)`/)?.[1]?.trim()
    || extractFirstNonEmptyLine(extractAfterHeading(section.body, "接口名称"));
  const rawURL = section.body.match(/`(https?:\/\/[^`]+)`/)?.[1]?.trim();
  if (!interfaceName || !rawURL) return null;

  const method = section.body.match(/`\s*(GET|POST|PUT|PATCH|DELETE)\s*`/i)?.[1]?.toUpperCase() || "POST";
  const description = extractFirstParagraph(extractAfterHeading(section.body, "接口说明")) || section.title;
  const parameters = parseParameterTable(extractAfterHeading(section.body, "请求参数"));
  const requestExample = extractRequestExample(section.body);

  return {
    name: interfaceName,
    title: section.title,
    description,
    method,
    rawURL,
    url: resolveEndpointURL(rawURL, environmentBaseURL),
    parameters,
    requestExample,
    inputSchema: buildInputSchema(parameters),
  };
}

function splitInterfaceSections(markdown) {
  const pattern = /^##\s+\d+\.\s+(.+)$/gm;
  const matches = Array.from(markdown.matchAll(pattern));
  const sections = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    sections.push({
      title: match[1].trim(),
      body: markdown.slice(match.index, next?.index ?? markdown.length),
    });
  }

  return sections;
}

function parseParameterTable(block) {
  const rows = [];
  for (const line of block.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    if (/^\|\s*-+/.test(line)) continue;
    if (line.includes("参数名") && line.includes("必填")) continue;

    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim().replace(/^`|`$/g, ""));

    if (cells.length < 5 || !cells[0]) continue;
    rows.push({
      name: cells[0],
      location: cells[1],
      type: cells[2],
      required: cells[3] === "是",
      description: cells.slice(4).join(" | "),
    });
  }
  return rows;
}

function buildInputSchema(parameters) {
  const properties = {};
  const required = [];

  for (const parameter of parameters) {
    properties[parameter.name] = {
      ...schemaForType(parameter.type),
      description: parameter.description,
    };
    if (parameter.required) required.push(parameter.name);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: true,
  };
}

function schemaForType(type) {
  const normalized = type.toLowerCase();
  if (normalized.includes("array")) {
    const itemType = normalized.match(/array\[(.+)\]/)?.[1] || "object";
    return {
      type: "array",
      items: schemaForType(itemType),
    };
  }
  if (normalized.includes("number") || normalized.includes("float") || normalized.includes("double")) return { type: "number" };
  if (normalized.includes("integer") || normalized.includes("int")) return { type: "integer" };
  if (normalized.includes("boolean") || normalized.includes("bool")) return { type: "boolean" };
  if (normalized.includes("object") || normalized.includes("map")) return { type: "object" };
  return { type: "string" };
}

function extractRequestExample(markdown) {
  const block = extractAfterHeading(markdown, "请求示例");
  const match = block.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return match[1].trim();
  }
}

function extractAfterHeading(markdown, heading) {
  const match = markdown.match(new RegExp(`^###\\s+${escapeRegex(heading)}\\s*$`, "m"));
  if (!match) return "";

  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^###\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function extractDocumentTitle(markdown) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
}

function extractDocumentDescription(markdown) {
  const common = extractAfterHeading(markdown, "通用说明");
  if (common) return "基于接口文档生成的 Aibase OpenAPI MCP 工具集。";
  return extractFirstParagraph(markdown.replace(/^#.*$/m, ""));
}

function extractFirstParagraph(block) {
  const lines = [];
  for (const line of block.split("\n")) {
    const value = line.trim();
    if (!value) {
      if (lines.length) break;
      continue;
    }
    if (value.startsWith("|") || value.startsWith("```") || value.startsWith("---")) continue;
    if (value.startsWith("#")) continue;
    lines.push(value);
  }
  return lines.join(" ");
}

function extractFirstNonEmptyLine(block) {
  return block.split("\n").map((line) => line.trim()).find(Boolean) || "";
}

function sanitizeDocumentName(value) {
  const base = basename(decodeURIComponent(value || "mcp-api.md")).trim();
  const extension = extname(base).toLowerCase();
  const stemSource = supportedMcpDocumentExtensions.has(extension)
    ? base.slice(0, -extension.length)
    : base;
  const stem = sanitizeFileStem(stemSource);
  return `${stem || "mcp-api"}${supportedMcpDocumentExtensions.has(extension) ? extension : ".md"}`;
}

function sanitizeFileStem(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function normalizeBasePath(pathname) {
  const value = pathname.replace(/\/+$/, "");
  return value === "" || value === "/" ? "" : value;
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "mcp-api";
}

function firstEnv(env, ...keys) {
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
