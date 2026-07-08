import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getMcpEnvironmentBaseURL, installMcpDocument, readMcpDocuments } from "./mcp/openapi-docs.mjs";
import { installBundleById, readMarketplaceIndex, uploadBundleToRegistry } from "./registry/registry-bundle.mjs";
import {
  createKnowledgeFile,
  createKnowledgeFolder,
  deleteKnowledgeFile,
  deleteKnowledgeFolder,
  ensureKnowledgeRoot,
  listKnowledgeTree,
  readKnowledgeFile,
  renameKnowledgeFile,
  renameKnowledgeFolder,
  updateKnowledgeFile,
} from "./knowledge/knowledge-manager.mjs";
import { deleteAgent, isValidAgentName, readAgent, readAgentsSync, writeAgent } from "./agents/agent-manager.mjs";
import { addRepo, deleteRepo, ensureRepoRoot, listRepos, retryClone } from "./repo/repo-manager.mjs";
import { initOpencodeClient, getClient } from "./opencode-client.mjs";
import { ConnectionManager } from "./connection-manager.mjs";
import { ConnectionState } from "./connection-state.mjs";

/** @type {ConnectionManager | null} */
let connectionManager = null;

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");
const publicRoot = join(projectRoot, "public");
const registryRoot = resolve(process.env.AIBASE_REGISTRY_ROOT ?? projectRoot);
const skillsRoot = resolve(process.env.AIBASE_SKILLS_DIR ?? join(projectRoot, "skills"));
const mcpRoot = resolve(process.env.AIBASE_MCP_DIR ?? join(projectRoot, "mcp"));
const agentsRoot = resolve(process.env.AIBASE_AGENTS_DIR ?? join(projectRoot, "agents"));
const knowledgeRoot = resolve(process.env.AIBASE_KNOWLEDGE_DIR ?? join(projectRoot, "knowledge"));
const repoRoot = resolve(process.env.AIBASE_REPO_DIR ?? join(projectRoot, "repo"));
const listenHost = process.env.AIBASE_HOST ?? "127.0.0.1";
const listenPort = Number(process.env.AIBASE_PORT ?? 3001);
const opencodeBin = process.env.OPENCODE_BIN ?? "opencode";
const opencodeHost = process.env.OPENCODE_HOST ?? "127.0.0.1";
const opencodePort = process.env.OPENCODE_PORT ? Number(process.env.OPENCODE_PORT) : null;
const opencodeTimeoutMs = Number(process.env.OPENCODE_START_TIMEOUT_MS ?? 10000);
const opencodeDirectory = resolve(process.env.AIBASE_WORKSPACE ?? projectRoot);
const opencodeUsername = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
const opencodePassword = process.env.OPENCODE_SERVER_PASSWORD;
const skillUploadMaxBytes = Number(process.env.AIBASE_SKILL_UPLOAD_MAX_BYTES ?? 50 * 1024 * 1024);
const marketplaceUploadMaxBytes = Number(process.env.AIBASE_MARKETPLACE_UPLOAD_MAX_BYTES ?? 50 * 1024 * 1024);
const promptStreamTimeoutMs = Number(process.env.AIBASE_PROMPT_STREAM_TIMEOUT_MS ?? 10 * 60 * 1000);
const pythonBin = process.env.PYTHON_BIN ?? "python3";
const mcpUploadMaxBytes = Number(process.env.AIBASE_MCP_UPLOAD_MAX_BYTES ?? 5 * 1024 * 1024);

let opencodeServer = null;

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const SKILL_IMPORT_SCRIPT = String.raw`
import json
import os
import posixpath
import re
import shutil
import sys
import tempfile
import zipfile

zip_path, skills_root, original_name = sys.argv[1:4]


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def clean_member_name(name):
    name = name.replace("\\", "/")
    name = posixpath.normpath(name)
    if name in ("", "."):
        return ""
    if name.startswith("../") or name == ".." or name.startswith("/"):
        fail(f"Unsafe zip path: {name}")
    return name


def parse_skill_name(markdown, fallback):
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", markdown, re.S)
    if match:
        for line in match.group(1).splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            if key.strip() == "name":
                candidate = value.strip().strip("\"'")
                if candidate:
                    return candidate
    return fallback


def slug(value):
    value = re.sub(r"\.zip$", "", value, flags=re.I)
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9-]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "imported-skill"


def is_valid_skill_name(value):
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", value))


def should_skip(name):
    parts = name.split("/")
    base = parts[-1]
    return (
        "__MACOSX" in parts
        or "__pycache__" in parts
        or base in (".DS_Store", "")
        or base.endswith(".pyc")
    )


skills_root = os.path.abspath(skills_root)
os.makedirs(skills_root, exist_ok=True)

try:
    archive = zipfile.ZipFile(zip_path)
except zipfile.BadZipFile:
    fail("Uploaded file is not a valid zip archive.")

with archive:
    files = []
    for info in archive.infolist():
        name = clean_member_name(info.filename)
        if not name or info.is_dir() or should_skip(name):
            continue
        if info.flag_bits & 0x1:
            fail("Encrypted zip files are not supported.")
        files.append((name, info))

    if not files:
        fail("Skill zip is empty.")

    skill_paths = [name for name, _ in files if name.endswith("/SKILL.md") or name == "SKILL.md"]
    if not skill_paths:
        fail("Skill zip must contain a SKILL.md file.")

    skill_path = sorted(skill_paths, key=lambda item: (item.count("/"), len(item)))[0]
    root_prefix = posixpath.dirname(skill_path)
    root_prefix_with_slash = f"{root_prefix}/" if root_prefix else ""
    fallback_name = slug(posixpath.basename(root_prefix) if root_prefix else original_name)

    skill_text = archive.read(skill_path).decode("utf-8", errors="replace")
    skill_name = parse_skill_name(skill_text, fallback_name)
    if not is_valid_skill_name(skill_name):
        fail(f"Invalid skill name '{skill_name}'. Use lowercase letters, numbers, and hyphens only.")

    target = os.path.abspath(os.path.join(skills_root, skill_name))
    if os.path.commonpath([skills_root, target]) != skills_root:
        fail("Resolved skill target is outside skills root.")

    staging = tempfile.mkdtemp(prefix=f".{skill_name}-", dir=skills_root)
    try:
        extracted = 0
        for name, info in files:
            if root_prefix:
                if not name.startswith(root_prefix_with_slash):
                    continue
                rel = name[len(root_prefix_with_slash):]
            else:
                rel = name
            rel = clean_member_name(rel)
            if not rel or should_skip(rel):
                continue

            destination = os.path.abspath(os.path.join(staging, *rel.split("/")))
            if os.path.commonpath([staging, destination]) != staging:
                fail(f"Unsafe extracted path: {rel}")
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            with archive.open(info) as src, open(destination, "wb") as dst:
                shutil.copyfileobj(src, dst)
            extracted += 1

        if not os.path.exists(os.path.join(staging, "SKILL.md")):
            fail("Extracted skill does not contain SKILL.md at its root.")

        overwritten = os.path.exists(target)
        if overwritten:
            shutil.rmtree(target)
        shutil.move(staging, target)
        staging = None

        print(json.dumps({
            "name": skill_name,
            "overwritten": overwritten,
            "files": extracted,
            "target": target,
        }, ensure_ascii=False))
    finally:
        if staging and os.path.exists(staging):
            shutil.rmtree(staging, ignore_errors=True)
`;

async function main() {
  await ensureRepoRoot();
  opencodeServer = await startOpencode();
  initOpencodeClient(opencodeServer.url, opencodePassword, opencodeUsername);
  connectionManager = new ConnectionManager({
    baseUrl: opencodeServer.url,
    directory: opencodeDirectory,
    password: opencodePassword,
  });

  // Start the global SSE connection and wait for it to establish.
  // Non-fatal on failure — REST endpoints still work without SSE.
  try {
    await connectionManager.ensureConnected(30_000);
    console.log("[main] EventSourceManager connected");
  } catch (err) {
    console.warn(`[main] EventSourceManager connection failed (non-fatal): ${err.message}`);
  }

  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      sendJson(res, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.listen(listenPort, listenHost, () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : listenPort;
    console.log(`aibase listening on http://${listenHost}:${port}`);
    console.log(`opencode kernel listening on ${opencodeServer.url}`);
    console.log(`project skills path: ${skillsRoot}`);
    console.log(`project mcp path: ${mcpRoot}`);
    console.log(`project repo path: ${repoRoot}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      opencodeServer?.close();
      server.close(() => process.exit(0));
    });
  }
}

async function startOpencode() {
  const port = opencodePort && opencodePort > 0
    ? opencodePort
    : await pickFreePort(opencodeHost);
  await ensureKnowledgeRoot(knowledgeRoot);
  const skillPaths = await discoverSkillPaths();
  const config = mergeOpencodeConfig({
    ...buildEnvOpencodeConfig(),
    skills: {
      paths: skillPaths,
    },
  });
  const env = buildOpencodeEnv(config);

  const args = [
    "serve",
    `--hostname=${opencodeHost}`,
    `--port=${port}`,
  ];

  const child = spawn(opencodeBin, args, {
    cwd: opencodeDirectory,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  let settled = false;
  let exit = null;

  const url = await new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Timed out after ${opencodeTimeoutMs}ms waiting for opencode to start.\n${output}`));
    }, opencodeTimeoutMs);

    child.stdout.on("data", (chunk) => {
      if (settled) {
        process.stdout.write(chunk);
      }
      output += chunk.toString();
      const line = output.split("\n").find((candidate) => candidate.startsWith("opencode server listening"));
      const match = line?.match(/on\s+(https?:\/\/[^\s]+)/);
      if (!match || settled) return;

      settled = true;
      clearTimeout(timeout);
      resolveUrl(match[1]);
    });

    child.stderr.on("data", (chunk) => {
      if (settled) {
        process.stderr.write(chunk);
      }
      output += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", (code, signal) => {
      exit = { code, signal };
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`opencode exited before listening. code=${code ?? "null"} signal=${signal ?? "null"}\n${output}`));
    });
  });

  return {
    child,
    get exit() {
      return exit;
    },
    url,
    isRunning() {
      return child.exitCode === null && child.signalCode === null && exit === null;
    },
    close() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    },
  };
}

async function restartOpencode() {
  opencodeServer?.close();
  opencodeServer = await startOpencode();
  initOpencodeClient(opencodeServer.url, opencodePassword, opencodeUsername);
  connectionManager?.shutdown();
  connectionManager = new ConnectionManager({
    baseUrl: opencodeServer.url,
    directory: opencodeDirectory,
    password: opencodePassword,
  });
  try {
    await connectionManager.ensureConnected(30_000);
    console.log("[restartOpencode] EventSourceManager connected");
  } catch (err) {
    console.warn(`[restartOpencode] EventSourceManager connection failed (non-fatal): ${err.message}`);
  }
}

async function discoverSkillPaths() {
  const paths = [skillsRoot];

  if (!existsSync(skillsRoot)) return paths;

  const entries = await readdir(skillsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const directory = join(skillsRoot, entry.name);
    if (existsSync(join(directory, "SKILL.md"))) {
      paths.push(directory);
    }
  }

  return Array.from(new Set(paths));
}

async function pickFreePort(host) {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();

    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (!port) reject(new Error("Could not allocate an internal opencode port."));
        else resolvePort(port);
      });
    });
  });
}

function mergeOpencodeConfig(overlay) {
  const existing = process.env.OPENCODE_CONFIG_CONTENT
    ? safeJsonParse(process.env.OPENCODE_CONFIG_CONTENT, {})
    : {};

  const existingPaths = Array.isArray(existing.skills?.paths) ? existing.skills.paths : [];
  const existingUrls = Array.isArray(existing.skills?.urls) ? existing.skills.urls : [];
  const nextPaths = Array.from(new Set([...existingPaths, ...overlay.skills.paths]));

  return {
    ...existing,
    ...overlay,
    agent: mergePlainObjects(existing.agent, overlay.agent),
    command: mergePlainObjects(existing.command, overlay.command),
    experimental: mergePlainObjects(existing.experimental, overlay.experimental),
    mcp: {
      "codebase-memory-mcp": {
        type: "local",
        command: ["codebase-memory-mcp"],
        enabled: true,
      },
      ...mergePlainObjects(existing.mcp, overlay.mcp),
    },
    permission: mergePlainObjects(existing.permission, overlay.permission),
    provider: mergePlainObjects(existing.provider, overlay.provider),
    references: mergePlainObjects(existing.references, overlay.references),
    tool_output: mergePlainObjects(existing.tool_output, overlay.tool_output),
    skills: {
      ...(existing.skills ?? {}),
      ...(overlay.skills ?? {}),
      paths: nextPaths,
      urls: existingUrls,
    },
  };
}

function buildEnvOpencodeConfig() {
  const config = {};

  setStringConfig(config, "model", "AIBASE_OPENCODE_MODEL", "OPENCODE_MODEL");
  setStringConfig(config, "small_model", "AIBASE_OPENCODE_SMALL_MODEL", "OPENCODE_SMALL_MODEL");
  setStringConfig(config, "default_agent", "AIBASE_OPENCODE_DEFAULT_AGENT", "OPENCODE_DEFAULT_AGENT");
  setStringConfig(config, "logLevel", "AIBASE_OPENCODE_LOG_LEVEL", "OPENCODE_LOG_LEVEL");
  setStringConfig(config, "share", "AIBASE_OPENCODE_SHARE", "OPENCODE_SHARE");
  setEnvValueConfig(config, "autoupdate", "AIBASE_OPENCODE_AUTOUPDATE", "OPENCODE_AUTOUPDATE");
  setBooleanConfig(config, "snapshot", "AIBASE_OPENCODE_SNAPSHOT", "OPENCODE_SNAPSHOT");
  setCsvConfig(config, "enabled_providers", "AIBASE_OPENCODE_ENABLED_PROVIDERS", "OPENCODE_ENABLED_PROVIDERS");
  setCsvConfig(config, "disabled_providers", "AIBASE_OPENCODE_DISABLED_PROVIDERS", "OPENCODE_DISABLED_PROVIDERS");
  setJsonConfig(config, "agent", "AIBASE_OPENCODE_AGENT_JSON");

  // Merge file-based agents from agents/ directory (higher priority than env-var agents)
  const fileAgents = readAgentsSync(agentsRoot);
  if (Object.keys(fileAgents).length > 0) {
    // Normalize agent mode — opencode only accepts "subagent" | "primary" | "all"
    for (const entry of Object.values(fileAgents)) {
      if (entry.mode === "agent") entry.mode = "subagent";
    }
    config.agent = mergePlainObjects(config.agent, fileAgents);
  }

  setJsonConfig(config, "command", "AIBASE_OPENCODE_COMMAND_JSON");
  setJsonConfig(config, "experimental", "AIBASE_OPENCODE_EXPERIMENTAL_JSON");
  setJsonConfig(config, "mcp", "AIBASE_OPENCODE_MCP_JSON");
  setJsonConfig(config, "permission", "AIBASE_OPENCODE_PERMISSION_JSON");
  // opencode question 工具仅 TUI 可响应（无 HTTP 端点），HTTP 客户端无法作答，
  // 默认 deny 防止模型调用后死锁；用户显式配置优先。
  config.permission = mergePlainObjects({ question: "deny" }, config.permission || {});
  setJsonConfig(config, "plugin", "AIBASE_OPENCODE_PLUGIN_JSON");
  setJsonConfig(config, "provider", "AIBASE_OPENCODE_PROVIDER_JSON");
  config.references = mergePlainObjects(config.references, {
    knowledge: {
      path: knowledgeRoot,
      description: "Use for local knowledge-base documents",
    },
  });
  setJsonConfig(config, "tool_output", "AIBASE_OPENCODE_TOOL_OUTPUT_JSON");

  return config;
}

function buildOpencodeEnv(config) {
  const env = { ...process.env };

  applyEnvAlias(env, "OPENAI_API_KEY", "AIBASE_OPENAI_API_KEY");
  applyEnvAlias(env, "OPENAI_BASE_URL", "AIBASE_OPENAI_BASE_URL");
  applyEnvAlias(env, "ANTHROPIC_API_KEY", "AIBASE_ANTHROPIC_API_KEY");
  applyEnvAlias(env, "ANTHROPIC_BASE_URL", "AIBASE_ANTHROPIC_BASE_URL");
  applyEnvAlias(env, "GOOGLE_GENERATIVE_AI_API_KEY", "AIBASE_GOOGLE_GENERATIVE_AI_API_KEY", "AIBASE_GEMINI_API_KEY");
  applyEnvAlias(env, "GEMINI_API_KEY", "AIBASE_GEMINI_API_KEY");
  applyEnvAlias(env, "GROQ_API_KEY", "AIBASE_GROQ_API_KEY");
  applyEnvAlias(env, "GROQ_BASE_URL", "AIBASE_GROQ_BASE_URL");
  applyEnvAlias(env, "OPENROUTER_API_KEY", "AIBASE_OPENROUTER_API_KEY");
  applyEnvAlias(env, "OPENROUTER_BASE_URL", "AIBASE_OPENROUTER_BASE_URL");
  applyEnvAlias(env, "AZURE_OPENAI_API_KEY", "AIBASE_AZURE_OPENAI_API_KEY");
  applyEnvAlias(env, "AZURE_OPENAI_ENDPOINT", "AIBASE_AZURE_OPENAI_ENDPOINT");
  applyEnvAlias(env, "AZURE_OPENAI_API_VERSION", "AIBASE_AZURE_OPENAI_API_VERSION");
  applyEnvAlias(env, "AWS_ACCESS_KEY_ID", "AIBASE_AWS_ACCESS_KEY_ID");
  applyEnvAlias(env, "AWS_SECRET_ACCESS_KEY", "AIBASE_AWS_SECRET_ACCESS_KEY");
  applyEnvAlias(env, "AWS_SESSION_TOKEN", "AIBASE_AWS_SESSION_TOKEN");
  applyEnvAlias(env, "AWS_REGION", "AIBASE_AWS_REGION");
  applyEnvAlias(env, "AWS_DEFAULT_REGION", "AIBASE_AWS_DEFAULT_REGION", "AIBASE_AWS_REGION");

  env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
  return env;
}

function applyEnvAlias(env, canonical, ...aliases) {
  if (env[canonical]) return;
  const value = firstEnv(...aliases);
  if (value) env[canonical] = value;
}

function setStringConfig(config, key, ...envNames) {
  const value = firstEnv(...envNames);
  if (value) config[key] = value;
}

function setEnvValueConfig(config, key, ...envNames) {
  const raw = firstEnv(...envNames);
  if (!raw) return;
  config[key] = parseEnvValue(raw);
}

function setBooleanConfig(config, key, ...envNames) {
  const raw = firstEnv(...envNames);
  if (!raw) return;
  config[key] = parseBoolean(raw);
}

function setCsvConfig(config, key, ...envNames) {
  const raw = firstEnv(...envNames);
  if (!raw) return;
  config[key] = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function setJsonConfig(config, key, envName) {
  const raw = firstEnv(envName);
  if (!raw) return;
  config[key] = safeJsonParse(raw, undefined);
  if (config[key] === undefined) {
    throw new Error(`${envName} must be valid JSON.`);
  }
}

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

function parseEnvValue(value) {
  if (/^(true|false)$/i.test(value)) return parseBoolean(value);
  return value;
}

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(value);
}

function mergePlainObjects(left, right) {
  if (!isPlainObject(left)) return right;
  if (!isPlainObject(right)) return left;
  return { ...left, ...right };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function route(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/api/health" && req.method === "GET") {
    const healthy = Boolean(opencodeServer?.isRunning());
    return sendJson(res, healthy ? 200 : 503, {
      name: "aibase",
      status: healthy ? "ok" : "opencode_unavailable",
      workspace: opencodeDirectory,
      skillsRoot,
      mcpRoot,
      agentsRoot,
      knowledgeRoot,
      repoRoot,
      environmentBaseURL: getMcpEnvironmentBaseURL(),
      opencode: {
        url: opencodeServer.url,
        exit: opencodeServer.exit,
      },
    });
  }

  if (url.pathname === "/api/skills" && req.method === "GET") {
    return sendJson(res, 200, await listSkills());
  }

  if (url.pathname === "/api/skills/upload" && req.method === "POST") {
    const fileName = decodeURIComponent(req.headers["x-file-name"] || "skill.zip");
    const archive = await readBody(req, skillUploadMaxBytes);
    if (archive.length === 0) {
      return sendJson(res, 400, { error: "empty_upload", message: "Skill zip is required." });
    }

    try {
      const result = await installSkillArchive(archive, fileName);
      await restartOpencode();
      return sendJson(res, 200, {
        ...result,
        opencodeRestarted: true,
        skills: await readLocalSkills(),
      });
    } catch (error) {
      return sendJson(res, 400, {
        error: "skill_import_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/marketplace/upload" && req.method === "POST") {
    const fileName = decodeURIComponent(req.headers["x-file-name"] || "bundle.zip");
    const archive = await readBody(req, marketplaceUploadMaxBytes);
    if (archive.length === 0) {
      return sendJson(res, 400, { error: "empty_upload", message: "Bundle zip is required." });
    }

    try {
      const result = await uploadBundleToRegistry(registryRoot, archive, fileName);
      return sendJson(res, 200, result);
    } catch (error) {
      return sendJson(res, 400, {
        error: "marketplace_upload_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/marketplace" && req.method === "GET") {
    return sendJson(res, 200, await readMarketplaceIndex(registryRoot));
  }

  const marketplaceInstallMatch = url.pathname.match(/^\/api\/marketplace\/([^/]+)\/install$/);
  if (marketplaceInstallMatch && req.method === "POST") {
    try {
      const result = await installBundleById(decodeURIComponent(marketplaceInstallMatch[1]), {
        registryRoot,
        installers: {
          skill: async (payload) => installSkillArchive(payload.buffer, `${payload.target}.zip`),
          mcp: async (payload) => installMcpDocument(mcpRoot, payload.buffer, payload.target),
          agent: async (payload) => writeAgent(agentsRoot, payload.target, JSON.parse(payload.buffer.toString("utf8"))),
          knowledge: async (payload) => {
            for (const entry of payload.entries) {
              const path = payload.sourceKind === "directory"
                ? `${payload.target}/${entry.relativePath}`.replace(/\/+/g, "/")
                : payload.target;
              await createKnowledgeFile(knowledgeRoot, path, entry.buffer.toString("utf8"));
            }
          },
        },
        restartRuntime: restartOpencode,
      });

      return sendJson(res, result.error ? 400 : 200, result);
    } catch (error) {
      const status = error?.code === "BUNDLE_NOT_FOUND" ? 404 : 400;
      const code = error?.code === "BUNDLE_NOT_FOUND" ? "marketplace_bundle_not_found" : "marketplace_install_failed";
      return sendJson(res, status, {
        error: code,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/mcp" && req.method === "GET") {
    return sendJson(res, 200, await listMcpDocuments());
  }

  if (url.pathname === "/api/mcp/upload" && req.method === "POST") {
    const fileName = decodeURIComponent(req.headers["x-file-name"] || "mcp-api.md");
    const document = await readBody(req, mcpUploadMaxBytes);
    if (document.length === 0) {
      return sendJson(res, 400, { error: "empty_upload", message: "MCP API document is required." });
    }

    try {
      const result = await installMcpDocument(mcpRoot, document, fileName);
      await restartOpencode();
      return sendJson(res, 200, {
        ...result,
        opencodeRestarted: true,
        documents: await readMcpDocuments(mcpRoot),
      });
    } catch (error) {
      return sendJson(res, 400, {
        error: "mcp_import_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // GET /api/agents — list all file-based agents
  if (url.pathname === "/api/agents" && req.method === "GET") {
    return sendJson(res, 200, listAgents());
  }

  // POST /api/agents — create a new agent
  if (url.pathname === "/api/agents" && req.method === "POST") {
    const body = await readJson(req);
    const name = String(body.name || "").trim().toLowerCase();

    if (!isValidAgentName(name)) {
      return sendJson(res, 400, {
        error: "invalid_agent_name",
        message: "Agent name must be 1-64 characters, lowercase alphanumeric, hyphens and underscores only.",
      });
    }

    const data = {
      mode: String(body.mode || "subagent").trim(),
      displayName: String(body.displayName || body.name || "").trim(),
      description: String(body.description || "").trim(),
      prompt: String(body.prompt || "").trim(),
      model: body.model ? String(body.model).trim() : undefined,
      enabled: body.enabled !== false,
    };

    if (!data.description) {
      return sendJson(res, 400, {
        error: "missing_description",
        message: "Agent description is required.",
      });
    }

    try {
      await writeAgent(agentsRoot, name, data);
      await restartOpencode();
      return sendJson(res, 200, {
        name,
        opencodeRestarted: true,
        agents: listAgents().agents,
      });
    } catch (error) {
      return sendJson(res, 400, {
        error: "agent_create_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // PATCH /api/agents/:name — update an existing agent
  const agentNameMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
  if (agentNameMatch && req.method === "PATCH") {
    const name = decodeURIComponent(agentNameMatch[1]);
    const body = await readJson(req);

    const data = {
      mode: body.mode ? String(body.mode).trim() : undefined,
      displayName: body.displayName ? String(body.displayName).trim() : undefined,
      description: body.description ? String(body.description).trim() : undefined,
      prompt: body.prompt ? String(body.prompt).trim() : undefined,
      model: body.model !== undefined ? (body.model ? String(body.model).trim() : "") : undefined,
      enabled: body.enabled !== undefined ? body.enabled !== false : undefined,
    };

    // Remove undefined keys so we merge rather than replace
    const clean = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) clean[key] = value;
    }

    // Read existing agent and merge
    let existing;
    try {
      existing = await readAgent(agentsRoot, name);
    } catch {
      existing = null;
    }

    if (!existing) {
      return sendJson(res, 404, {
        error: "agent_not_found",
        message: `Agent "${name}" not found.`,
      });
    }

    try {
      await writeAgent(agentsRoot, name, { ...existing, ...clean });
      await restartOpencode();
      return sendJson(res, 200, {
        name,
        opencodeRestarted: true,
        agents: listAgents().agents,
      });
    } catch (error) {
      return sendJson(res, 400, {
        error: "agent_update_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // DELETE /api/agents/:name — delete an agent
  if (agentNameMatch && req.method === "DELETE") {
    const name = decodeURIComponent(agentNameMatch[1]);

    try {
      const existed = await deleteAgent(agentsRoot, name);
      if (!existed) {
        return sendJson(res, 404, {
          error: "agent_not_found",
          message: `Agent "${name}" not found.`,
        });
      }
      await restartOpencode();
      return sendJson(res, 200, {
        ok: true,
        opencodeRestarted: true,
        agents: listAgents().agents,
      });
    } catch (error) {
      return sendJson(res, 400, {
        error: "agent_delete_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/knowledge" && req.method === "GET") {
    return sendJson(res, 200, await listKnowledge());
  }

  if (url.pathname === "/api/knowledge/file" && req.method === "GET") {
    const filePath = String(url.searchParams.get("path") || "").trim();
    if (!filePath) {
      return sendJson(res, 400, {
        error: "missing_path",
        message: "Knowledge file path is required.",
      });
    }

    try {
      const content = await readKnowledgeFile(knowledgeRoot, filePath);
      return sendJson(res, 200, {
        path: filePath,
        content,
      });
    } catch (error) {
      return sendJson(res, 400, {
        error: "knowledge_read_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/knowledge/folders" && req.method === "POST") {
    const body = await readJson(req);
    const folderPath = String(body.path || "").trim();
    if (!folderPath) {
      return sendJson(res, 400, {
        error: "missing_path",
        message: "Folder path is required.",
      });
    }

    try {
      await createKnowledgeFolder(knowledgeRoot, folderPath);
      return sendJson(res, 200, await listKnowledge());
    } catch (error) {
      return sendJson(res, 400, {
        error: "knowledge_folder_create_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/knowledge/folders" && req.method === "PATCH") {
    const body = await readJson(req);
    const from = String(body.from || "").trim();
    const to = String(body.to || "").trim();
    if (!from || !to) {
      return sendJson(res, 400, {
        error: "missing_path",
        message: "Both source and target folder paths are required.",
      });
    }

    try {
      await renameKnowledgeFolder(knowledgeRoot, from, to);
      return sendJson(res, 200, await listKnowledge());
    } catch (error) {
      return sendJson(res, 400, {
        error: "knowledge_folder_rename_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/knowledge/folders" && req.method === "DELETE") {
    const body = await readJson(req);
    const folderPath = String(body.path || "").trim();
    if (!folderPath) {
      return sendJson(res, 400, {
        error: "missing_path",
        message: "Folder path is required.",
      });
    }

    try {
      await deleteKnowledgeFolder(knowledgeRoot, folderPath);
      return sendJson(res, 200, await listKnowledge());
    } catch (error) {
      return sendJson(res, 400, {
        error: "knowledge_folder_delete_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/knowledge/files" && req.method === "POST") {
    const body = await readJson(req);
    const filePath = String(body.path || "").trim();
    if (!filePath) {
      return sendJson(res, 400, {
        error: "missing_path",
        message: "Knowledge file path is required.",
      });
    }

    try {
      await createKnowledgeFile(knowledgeRoot, filePath, body.content || "");
      return sendJson(res, 200, await listKnowledge());
    } catch (error) {
      return sendJson(res, 400, {
        error: "knowledge_file_create_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/knowledge/files" && req.method === "PATCH") {
    const body = await readJson(req);
    const from = String(body.from || "").trim();
    const to = String(body.to || "").trim();
    const filePath = String(body.path || "").trim();

    try {
      if (from && to) {
        await renameKnowledgeFile(knowledgeRoot, from, to);
      } else if (filePath) {
        await updateKnowledgeFile(knowledgeRoot, filePath, body.content || "");
      } else {
        return sendJson(res, 400, {
          error: "missing_path",
          message: "Provide either path for content update or from/to for rename.",
        });
      }

      return sendJson(res, 200, await listKnowledge());
    } catch (error) {
      return sendJson(res, 400, {
        error: "knowledge_file_update_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/knowledge/files" && req.method === "DELETE") {
    const body = await readJson(req);
    const filePath = String(body.path || "").trim();
    if (!filePath) {
      return sendJson(res, 400, {
        error: "missing_path",
        message: "Knowledge file path is required.",
      });
    }

    try {
      await deleteKnowledgeFile(knowledgeRoot, filePath);
      return sendJson(res, 200, await listKnowledge());
    } catch (error) {
      return sendJson(res, 400, {
        error: "knowledge_file_delete_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Repo / 代码库 routes

  if (url.pathname === "/api/repos" && req.method === "GET") {
    return sendJson(res, 200, { repos: listRepos() });
  }

  if (url.pathname === "/api/repos" && req.method === "POST") {
    const body = await readJson(req);
    const url = String(body.url || "").trim();

    if (!url) {
      return sendJson(res, 400, {
        error: "missing_url",
        message: "Repository URL is required.",
      });
    }

    try {
      const repo = await addRepo({
        url,
        branch: body.branch || "",
        depth: body.depth ? Number(body.depth) : 0,
        username: body.username || "",
        email: body.email || "",
        password: body.password || "",
        token: body.token || "",
        ssh_key: body.ssh_key || "",
      });
      return sendJson(res, 200, { repo, repos: listRepos() });
    } catch (error) {
      return sendJson(res, 400, {
        error: "repo_add_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const repoNameMatch = url.pathname.match(/^\/api\/repos\/([^/]+)$/);
  if (repoNameMatch && req.method === "DELETE") {
    const name = decodeURIComponent(repoNameMatch[1]);
    try {
      const result = await deleteRepo(name);
      return sendJson(res, 200, { ...result, repos: listRepos() });
    } catch (error) {
      return sendJson(res, 400, {
        error: "repo_delete_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const repoRetryMatch = url.pathname.match(/^\/api\/repos\/([^/]+)\/retry$/);
  if (repoRetryMatch && req.method === "POST") {
    const name = decodeURIComponent(repoRetryMatch[1]);
    try {
      const result = await retryClone(name);
      return sendJson(res, 200, { ...result, repos: listRepos() });
    } catch (error) {
      return sendJson(res, 400, {
        error: "repo_retry_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/runtime/restart" && req.method === "POST") {
    try {
      await restartOpencode();
      return sendJson(res, 200, {
        ok: true,
        opencodeRestarted: true,
        status: "ok",
        url: opencodeServer.url,
      });
    } catch (error) {
      return sendJson(res, 500, {
        error: "runtime_restart_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/sessions" && req.method === "GET") {
    const includeArchived = parseBoolean(url.searchParams.get("archived") || "false");
    const sessions = await connectionManager.client.session.list({
      query: {
        directory: opencodeDirectory,
        roots: url.searchParams.get("roots") ?? "true",
        limit: url.searchParams.get("limit") ?? "40",
        search: url.searchParams.get("search") ?? undefined,
      },
    });
    return sendJson(res, 200, includeArchived
      ? sessions
      : sessions.filter((session) => !session.time?.archived));
  }

  if (url.pathname === "/api/sessions" && req.method === "POST") {
    const body = await readJson(req);
    const session = await connectionManager.client.session.create({
      query: { directory: opencodeDirectory },
      body: {
        title: body.title || "Aibase session",
        permission: body.permission,
      },
    });
    return sendJson(res, 200, session);
  }

  const titleMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/title$/);
  if (titleMatch && req.method === "PATCH") {
    const body = await readJson(req);
    const title = normalizeSessionTitle(body.title);

    if (!title) {
      return sendJson(res, 400, { error: "empty_title", message: "Session title is required." });
    }

    const result = await connectionManager.client.session.update({
      path: { id: titleMatch[1] },
      query: { directory: opencodeDirectory },
      body: { title },
    });
    return sendJson(res, 200, result);
  }

  const archiveMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/archive$/);
  if (archiveMatch && req.method === "PATCH") {
    const body = await readJson(req);
    const archived = body.archived === undefined ? true : parseBoolean(String(body.archived));

    const result = await connectionManager.client.session.update({
      path: { id: archiveMatch[1] },
      query: { directory: opencodeDirectory },
      body: {
        time: {
          archived: archived ? Date.now() : null,
        },
      },
    });
    return sendJson(res, 200, result);
  }

  const messageMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (messageMatch && req.method === "GET") {
    const messages = await connectionManager.client.session.messages({
      path: { id: messageMatch[1] },
      query: {
        directory: opencodeDirectory,
        limit: url.searchParams.get("limit") ?? "100",
      },
    });
    return sendJson(res, 200, messages);
  }

  const promptStreamMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/prompt\/stream$/);
  if (promptStreamMatch && req.method === "POST") {
    return streamPrompt(req, res, promptStreamMatch[1]);
  }

  const permissionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/permissions\/([^/]+)$/);
  if (permissionMatch && req.method === "POST") {
    return respondPermission(req, res, permissionMatch[1], permissionMatch[2]);
  }

  const promptMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/prompt$/);
  if (promptMatch && req.method === "POST") {
    const body = await readJson(req);
    const text = String(body.text ?? "").trim();

    if (!text) {
      return sendJson(res, 400, { error: "empty_prompt", message: "Prompt text is required." });
    }

    const result = await connectionManager.client.session.prompt({
      path: { id: promptMatch[1] },
      query: { directory: opencodeDirectory },
      body: {
        agent: body.agent || undefined,
        model: normalizePromptModel(body.model),
        system: body.system || undefined,
        parts: [{ type: "text", text }],
      },
    });
    return sendJson(res, 200, result);
  }

  const rawProxyMatch = url.pathname.match(/^\/api\/opencode(\/.*)?$/);
  if (rawProxyMatch) {
    const path = rawProxyMatch[1] || "/";
    return proxyRaw(req, res, path + url.search);
  }

  if (req.method === "GET" || req.method === "HEAD") {
    return serveStatic(url.pathname, res);
  }

  sendJson(res, 404, { error: "not_found" });
}

async function respondPermission(req, res, sessionID, permissionID) {
  const body = await readJson(req);
  const response = String(body.response ?? "").trim();
  if (!["once", "always", "reject"].includes(response)) {
    return sendJson(res, 400, { error: "invalid_response", message: "response must be one of: once, always, reject." });
  }

  try {
    await connectionManager.client.postSessionIdPermissionsPermissionId({
      path: { id: sessionID, permissionID },
      query: { directory: opencodeDirectory },
      body: { response },
    });
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 502, {
      error: "opencode_permission_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function streamPrompt(req, res, sessionID) {
  const body = await readJson(req);
  const text = String(body.text ?? "").trim();

  if (!text) {
    return sendJson(res, 400, { error: "empty_prompt", message: "Prompt text is required." });
  }

  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, promptStreamTimeoutMs);
  let responseOpen = true;

  res.on("close", () => {
    responseOpen = false;
    abortController.abort();
  });

  writeSseHead(res);

  const writeEvent = (event, payload = {}) => {
    if (!responseOpen || res.destroyed) return;
    writeSse(res, event, payload);
  };
  const traceKeys = new Set();
  const writeTrace = (payload = {}, key = "") => {
    const label = String(payload.label || "").trim();
    const detail = String(payload.detail || "").trim();
    const dedupeKey = key || `${payload.kind || "status"}:${label}:${detail}`;
    if (dedupeKey && traceKeys.has(dedupeKey)) return;
    if (dedupeKey) traceKeys.add(dedupeKey);
    writeEvent("trace", {
      kind: payload.kind || "status",
      label: label || "正在处理",
      detail,
      time: Date.now(),
    });
  };

  const closeStream = () => {
    if (!responseOpen || res.destroyed) return;
    responseOpen = false;
    clearTimeout(timeout);
    res.end();
  };

  const messageRoles = new Map();
  const assistantParts = new Map();
  let activeAssistantMessageID = "";
  let sawPromptActivity = false;
  let finished = false;
  let finishTimer = null;

  const emitFinalMessages = async () => {
    try {
      const messages = await connectionManager.client.session.messages({
        path: { id: sessionID },
        query: { directory: opencodeDirectory, limit: 100 },
        signal: abortController.signal,
      });
      writeEvent("messages", { messages });
    } catch (error) {
      writeEvent("error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const finish = async () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    if (finishTimer) clearTimeout(finishTimer);
    await emitFinalMessages();
    // Write terminal events directly — bypass writeEvent's responseOpen guard
    // because res.on("close") may have already set responseOpen=false.
    if (!res.destroyed) {
      writeSse(res, "trace", { kind: "done", label: "响应已完成", time: Date.now() });
      writeSse(res, "done", {});
    }
    abortController.abort();
    closeStream();
  };

  const finishSoon = () => {
    if (finishTimer || finished) return;
    finishTimer = setTimeout(() => {
      finishTimer = null;
      finish().catch((error) => {
        if (!res.destroyed) {
          writeSse(res, "error", { message: error instanceof Error ? error.message : String(error) });
          writeSse(res, "done", {});
        }
        closeStream();
      });
    }, 600);
  };

  const cancelFinish = () => {
    if (finishTimer) {
      clearTimeout(finishTimer);
      finishTimer = null;
    }
  };

  let unsubEvent = null;
  let unsubState = null;

  try {
    writeEvent("phase", { label: "正在连接" });
    writeTrace({ label: "正在连接 opencode 事件流" }, "connect");

    // Register on the global SSE event stream — no separate subscription per prompt.
    // Events arrive through EventSourceManager → ConnectionManager → this handler.
    unsubEvent = connectionManager.onEvent((scopedEvent) => {
      if (finished) return;
      // Filter by directory — only process events for this workspace
      if (scopedEvent.workspaceKey.path !== opencodeDirectory) return;

      try {
        handlePromptEvent({
          event: scopedEvent.event,
          sessionID,
          messageRoles,
          assistantParts,
          get activeAssistantMessageID() { return activeAssistantMessageID; },
          set activeAssistantMessageID(value) { activeAssistantMessageID = value; },
          get sawPromptActivity() { return sawPromptActivity; },
          set sawPromptActivity(value) { sawPromptActivity = value; },
          writeEvent,
          writeTrace,
          finish,
          finishSoon,
          cancelFinish,
          startCompletionPoll: null,
        });
      } catch (err) {
        console.error("[streamPrompt] error handling SSE event:", err?.message || err);
        writeEvent("error", { message: `Event processing error: ${err?.message || err}` });
      }
    });

    // Listen for global connection state changes — finish prompt if connection is lost
    unsubState = connectionManager.onStateChange((state) => {
      if (finished) return;
      if (state === ConnectionState.Disconnected || state === ConnectionState.Error) {
        console.warn(`[streamPrompt] connection state → ${state}, finishing prompt`);
        writeEvent("error", { message: `Server connection lost (${state}).` });
        finish().catch((err) => {
          console.error("[streamPrompt] error during forced finish:", err?.message || err);
        });
      }
    });

    // Ensure the EventSourceManager is connected before sending prompt
    if (!connectionManager.isConnected) {
      writeTrace({ label: "等待 opencode 连接就绪" }, "wait-connect");
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("opencode connection timeout")), 10_000);
        const unsub = connectionManager.onStateChange((s) => {
          if (s === ConnectionState.Connected) {
            clearTimeout(t);
            unsub();
            resolve();
          }
        });
        if (connectionManager.isConnected) { clearTimeout(t); unsub(); resolve(); }
      });
    }

    writeTrace({ label: "事件流已连接，等待模型响应" }, "connected");
    writeEvent("phase", { label: "正在分析" });
    writeTrace({ label: "请求已发送给 opencode" }, "prompt-send");

    await connectionManager.client.session.promptAsync({
      path: { id: sessionID },
      query: { directory: opencodeDirectory },
      body: {
        agent: body.agent || undefined,
        model: normalizePromptModel(body.model),
        system: body.system || undefined,
        parts: [{ type: "text", text }],
      },
      signal: abortController.signal,
    }).then(() => {
      writeTrace({ label: "opencode 已接受请求，模型开始处理" }, "prompt-accepted");
      writeEvent("accepted", {});
    });

    // Wait for prompt to finish — events arrive via onEvent handler above,
    // and handlePromptEvent calls finishSoon → finish when the session goes idle.
    while (!finished && !abortController.signal.aborted) {
      await new Promise(r => setTimeout(r, 200));
    }

    // Ensure stream is always properly finalized — whether finish() was called
    // normally or the while loop exited because the client disconnected.
    if (!finished) {
      await finish();
    }

  } catch (error) {
    // Always write a terminal event before closing, regardless of abort state.
    // The old guard (!abortController.signal.aborted || timedOut) could skip
    // "done" when the client disconnected mid-stream.
    if (!finished) {
      const msg = timedOut
        ? `Prompt stream timed out after ${promptStreamTimeoutMs}ms.`
        : error instanceof Error ? error.message : String(error);
      writeEvent("error", { message: msg });
      writeTrace({ kind: "error", label: "流式请求失败", detail: msg }, "stream-error");
    }
    if (!finished && !timedOut) {
      writeEvent("done", {});
    }
    closeStream();
  } finally {
    unsubEvent?.();
    unsubState?.();
    clearTimeout(timeout);
    if (finishTimer) clearTimeout(finishTimer);
  }
}

async function handlePromptEvent(context) {
  const { event, sessionID, messageRoles, assistantParts, writeEvent, writeTrace, finishSoon, cancelFinish, startCompletionPoll } = context;
  const callPoll = startCompletionPoll ? () => callPoll() : () => {};
  const properties = event.properties ?? {};
  const eventSessionID = properties.sessionID
    || properties.info?.sessionID
    || properties.part?.sessionID;

  if (eventSessionID && eventSessionID !== sessionID) return;

  switch (event.type) {
    case "message.updated": {
      cancelFinish();
      const info = properties.info;
      if (!info?.id) return;

      if (info.role) messageRoles.set(info.id, info.role);
      if (info.role === "assistant") {
        context.activeAssistantMessageID = info.id;
        context.sawPromptActivity = true;
        callPoll();
        if (info.finish === "tool-calls") {
          writeTrace({ kind: "tool", label: "模型准备调用工具" }, `tool-calls:${info.id}`);
          writeEvent("phase", { label: "正在调用工具" });
        } else if (info.finish) {
          writeTrace({ kind: "done", label: "模型生成完成" }, `message-finish:${info.id}:${info.finish}`);
          finishSoon();
        }
        if (info.error) {
          writeTrace({
            kind: "error",
            label: "模型返回错误",
            detail: formatOpencodeError(info.error),
          }, `message-error:${info.id}`);
          writeEvent("error", { message: formatOpencodeError(info.error) });
        }
      }
      if (info.role === "user") {
        context.sawPromptActivity = true;
      }
      break;
    }

    case "message.part.updated": {
      cancelFinish();
      const part = properties.part;
      if (!part?.messageID) return;

      const role = messageRoles.get(part.messageID)
        || (part.messageID === context.activeAssistantMessageID ? "assistant" : "");

      if (role !== "assistant") return;
      context.sawPromptActivity = true;

      if (part.type === "text") {
        const messageParts = assistantParts.get(part.messageID) ?? new Map();
        messageParts.set(part.id, part.text ?? "");
        assistantParts.set(part.messageID, messageParts);
        const text = Array.from(messageParts.values()).filter(Boolean).join("\n\n");
        if (text.trim()) {
          writeEvent("assistant", {
            messageID: part.messageID,
            text,
          });
          writeTrace({
            label: `正在生成回复（约 ${text.length} 字）`,
          }, `generate:${part.messageID}:${Math.floor(text.length / 180)}`);
          writeEvent("phase", { label: "正在生成" });
          callPoll();
        }
      } else if (part.type === "step-finish") {
        writeTrace({ kind: "done", label: "当前推理步骤完成" }, `step-finish:${part.messageID}:${part.id || ""}`);
        finishSoon();
      } else if (part.type?.includes("tool")) {
        writeTrace({
          kind: "tool",
          label: describeToolPart(part),
          detail: formatTraceDetail(part),
        }, `tool:${part.messageID}:${part.id || part.toolCallID || part.callID || part.type}:${part.state?.status || part.status || ""}`);
        writeEvent("phase", { label: "正在调用工具" });
      } else if (assistantParts.has(part.messageID)) {
        callPoll();
      }
      break;
    }

    case "session.status": {
      if (!context.sawPromptActivity) return;
      const statusType = properties.status?.type;
      if (statusType === "busy") {
        writeTrace({ label: "模型正在分析上下文" }, "status-busy");
        writeEvent("phase", { label: "正在分析" });
      }
      if (statusType === "idle") finishSoon();
      break;
    }

    case "session.error": {
      cancelFinish();
      context.sawPromptActivity = true;
      writeTrace({
        kind: "error",
        label: "会话发生错误",
        detail: formatOpencodeError(properties.error),
      }, "session-error");
      writeEvent("error", { message: formatOpencodeError(properties.error) });
      break;
    }

    case "session.idle": {
      if (context.sawPromptActivity) finishSoon();
      break;
    }

    case "permission.asked": {
      cancelFinish();
      context.sawPromptActivity = true;
      const permission = properties;
      const patterns = Array.isArray(permission.patterns) ? permission.patterns : (permission.pattern ? [permission.pattern] : []);
      writeTrace({
        kind: "permission",
        label: buildPermissionTitle(permission),
        detail: formatPermissionDetail(permission),
      }, `permission:${permission.id || ""}`);
      writeEvent("permission", {
        id: permission.id,
        type: permission.permission || "",
        pattern: patterns,
        title: buildPermissionTitle(permission),
        command: permission.metadata?.command || "",
        sessionID: permission.sessionID,
      });
      break;
    }

    default:
      break;
  }
}

function writeSseHead(res) {
  res.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function normalizePromptModel(model) {
  if (!model) return undefined;

  if (Array.isArray(model) || typeof model !== "object") {
    const parts = typeof model === "string" ? model.split("/", 2) : null;
    if (parts && parts[0] && parts[1]) {
      return { providerID: parts[0], modelID: parts[1] };
    }
    return undefined;
  }

  return model;
}

function buildPermissionTitle(permission) {
  if (!permission) return "需要授权才能继续";
  const command = permission.metadata?.command || "";
  if (command) return `请求执行：${command.slice(0, 100)}`;
  const kind = permission.permission || "";
  if (kind) return `请求授权：${kind}`;
  return "需要授权才能继续";
}

function formatPermissionDetail(permission) {
  if (!permission) return "";
  const parts = [];
  if (permission.permission) parts.push(`类型：${permission.permission}`);
  const rawPatterns = Array.isArray(permission.patterns)
    ? permission.patterns
    : (permission.pattern ? [permission.pattern] : []);
  if (rawPatterns.length) parts.push(`规则：${rawPatterns.join("、")}`);
  const command = permission.metadata?.command;
  if (command) parts.push(`命令：${command}`);
  return parts.join("\n");
}

function formatOpencodeError(error) {
  if (!error) return "opencode returned an error.";
  if (typeof error === "string") return error;
  if (error.data?.message) return error.data.message;
  if (error.message) return error.message;
  return JSON.stringify(error);
}

function describeToolPart(part) {
  const name = firstTraceValue(
    part.tool,
    part.toolName,
    part.name,
    part.state?.tool,
    part.state?.name,
    part.call?.tool,
    part.call?.name,
  );
  const status = firstTraceValue(part.status, part.state?.status, part.state?.type);
  const suffix = status ? `（${status}）` : "";
  return name ? `调用工具：${name}${suffix}` : `调用工具：${part.type || "unknown"}${suffix}`;
}

function formatTraceDetail(part) {
  const detail = removeEmptyTraceFields({
    type: part.type,
    id: part.id,
    tool: firstTraceValue(part.tool, part.toolName, part.name, part.state?.tool, part.state?.name),
    status: firstTraceValue(part.status, part.state?.status, part.state?.type),
    input: part.input ?? part.args ?? part.arguments ?? part.state?.input ?? part.state?.args,
    output: part.output ?? part.result ?? part.state?.output ?? part.state?.result,
    error: part.error ?? part.state?.error,
  });

  const text = JSON.stringify(sanitizeTraceValue(detail), null, 2);
  return text === "{}" ? "" : truncateText(text, 900);
}

function firstTraceValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    return String(value);
  }
  return "";
}

function removeEmptyTraceFields(value) {
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === "") continue;
    result[key] = item;
  }
  return result;
}

function sanitizeTraceValue(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitizeTraceValue(item, depth + 1));
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? truncateText(value, 500) : value;
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(authorization|api[-_]?key|secret|token|password|credential)/i.test(key)) {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = sanitizeTraceValue(item, depth + 1);
  }
  return result;
}

function truncateText(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function listSkills() {
  const local = await readLocalSkills();
  return {
    source: "local",
    skills: local,
  };
}

async function listMcpDocuments() {
  return {
    source: "local",
    root: mcpRoot,
    environmentBaseURL: getMcpEnvironmentBaseURL(),
    documents: await readMcpDocuments(mcpRoot),
  };
}

function listAgents() {
  const map = readAgentsSync(agentsRoot);
  const agents = Object.entries(map).map(([name, config]) => ({
    name,
    mode: config.mode || "subagent",
    displayName: config.displayName || name,
    description: config.description || "",
    prompt: config.prompt || "",
    model: config.model || "",
    enabled: config.enabled !== false,
  }));

  return {
    source: "local",
    root: agentsRoot,
    agents: agents.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

async function listKnowledge() {
  await ensureKnowledgeRoot(knowledgeRoot);
  return {
    source: "local",
    root: knowledgeRoot,
    supportedExtensions: [".md", ".txt", ".json"],
    tree: await listKnowledgeTree(knowledgeRoot),
  };
}

async function readLocalSkills() {
  if (!existsSync(skillsRoot)) return [];

  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillFile = join(skillsRoot, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    const content = await readFile(skillFile, "utf8");
    const frontmatter = parseFrontmatter(content);
    const markdown = stripFrontmatter(content);
    const displayName = frontmatter.displayName
      || frontmatter.display_name
      || extractHeading(markdown, 1)
      || frontmatter.name
      || entry.name;
    const overview = frontmatter.overview
      || extractFirstSection(markdown)
      || frontmatter.description
      || "";

    skills.push({
      name: frontmatter.name || entry.name,
      displayName,
      description: frontmatter.description || "",
      overview,
      location: skillFile,
    });
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

async function installSkillArchive(archive, fileName) {
  await mkdir(skillsRoot, { recursive: true });

  const workDir = await mkdtemp(join(tmpdir(), "aibase-skill-"));
  const archivePath = join(workDir, "skill.zip");
  await writeFile(archivePath, archive);

  try {
    const output = await runPython(SKILL_IMPORT_SCRIPT, [archivePath, skillsRoot, fileName]);
    return safeJsonParse(output, {
      name: fileName.replace(/\.zip$/i, ""),
      message: output.trim(),
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function runPython(script, args) {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(pythonBin, ["-c", script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveOutput(stdout);
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `${pythonBin} exited with code ${code}`));
    });
  });
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---")) return {};
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return {};

  const fields = {};
  const block = markdown.slice(3, end).trim();
  for (const line of block.split("\n")) {
    const index = line.indexOf(":");
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    fields[key] = value;
  }
  return fields;
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith("---")) return markdown;

  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return markdown;
  return markdown.slice(end + 4).trimStart();
}

function extractHeading(markdown, level) {
  const prefix = "#".repeat(level);
  for (const line of markdown.split("\n")) {
    if (!line.startsWith(`${prefix} `)) continue;
    return line.slice(prefix.length).trim();
  }
  return "";
}

function extractFirstSection(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## "));
  if (start === -1) return "";

  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    section.push(line);
  }

  return section.join("\n").trim();
}

function normalizeSessionTitle(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

async function proxyRaw(req, res, pathWithSearch) {
  const target = new URL(pathWithSearch, opencodeServer.url);
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("authorization");
  applyOpencodeAuth(headers);

  const response = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
    duplex: req.method === "GET" || req.method === "HEAD" ? undefined : "half",
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  res.writeHead(response.status, Object.fromEntries(responseHeaders.entries()));
  if (!response.body) return res.end();

  for await (const chunk of response.body) {
    res.write(chunk);
  }
  res.end();
}

function applyOpencodeAuth(headers) {
  if (!opencodePassword) return;

  const token = Buffer.from(`${opencodeUsername}:${opencodePassword}`).toString("base64");
  headers.set("authorization", `Basic ${token}`);
}

async function readJson(req) {
  const text = (await readBody(req)).toString("utf8");
  if (!text) return {};
  return safeJsonParse(text, {});
}

async function readBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(`Request body exceeds ${maxBytes} bytes.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveStatic(pathname, res) {
  const normalizedPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = resolve(publicRoot, "." + normalizedPath);

  if (!isInside(publicRoot, filePath)) {
    return sendJson(res, 403, { error: "forbidden" });
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return sendJson(res, 404, { error: "not_found" });
  }

  if (!fileStat.isFile()) {
    return sendJson(res, 404, { error: "not_found" });
  }

  res.writeHead(200, {
    "cache-control": "no-store",
    "content-type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream",
    "content-length": fileStat.size,
  });
  createReadStream(filePath).pipe(res);
}

function isInside(root, target) {
  const relative = target.slice(resolve(root).length);
  return target === resolve(root) || (relative.startsWith(sep) && !relative.includes(`..${sep}`));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

main().catch((error) => {
  console.error(error);
  opencodeServer?.close();
  process.exit(1);
});
