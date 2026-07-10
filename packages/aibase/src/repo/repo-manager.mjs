import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile, unlink } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "../..");
const REPO_DIR = resolve(process.env.AIBASE_REPO_DIR ?? join(projectRoot, "repo"));

let db = null;

// --- Init ---

export function ensureRepoRoot() {
  return mkdir(REPO_DIR, { recursive: true });
}

function getDb() {
  if (db) return db;
  const dbPath = join(REPO_DIR, "repos.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      url         TEXT    NOT NULL,
      branch      TEXT    DEFAULT '',
      depth       INTEGER DEFAULT 0,
      username    TEXT    DEFAULT '',
      email       TEXT    DEFAULT '',
      password    TEXT    DEFAULT '',
      token       TEXT    DEFAULT '',
      ssh_key     TEXT    DEFAULT '',
      status      TEXT    NOT NULL DEFAULT 'pulling',
      error_msg   TEXT    DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS repo_clone_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_name   TEXT    NOT NULL UNIQUE,
      pid         INTEGER,
      started_at  TEXT    DEFAULT (datetime('now'))
    );
  `);
  return db;
}

// --- Public API ---

export async function addRepo(config) {
  const { url, branch, depth, username, email, password, token, ssh_key } = config;
  const name = extractRepoName(url);
  if (!name) throw new Error("Cannot extract repo name from URL. Ensure it ends with .git or is a valid git URL.");

  const database = getDb();

  const existing = database.prepare("SELECT id FROM repos WHERE name = ?").get(name);
  if (existing) throw new Error(`Repo "${name}" already exists.`);

  await ensureRepoRoot();

  database.prepare(`
    INSERT INTO repos (name, url, branch, depth, username, email, password, token, ssh_key, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pulling')
  `).run(
    name,
    url,
    String(branch ?? ""),
    Number(depth ?? 0),
    String(username ?? ""),
    String(email ?? ""),
    String(password ?? ""),
    String(token ?? ""),
    String(ssh_key ?? ""),
  );

  // Start background clone
  startClone(name).catch((error) => {
    console.error(`[repo] clone failed for ${name}:`, error.message);
  });

  return { name, url, status: "pulling" };
}

export function listRepos() {
  const database = getDb();
  return database.prepare(`
    SELECT name, url, branch, depth, status, error_msg, created_at, updated_at
    FROM repos
    ORDER BY created_at DESC
  `).all();
}

export async function deleteRepo(name) {
  const database = getDb();
  const repo = database.prepare("SELECT id FROM repos WHERE name = ?").get(name);
  if (!repo) throw new Error(`Repo "${name}" not found.`);

  const repoPath = join(REPO_DIR, name);
  if (existsSync(repoPath)) {
    await rm(repoPath, { recursive: true, force: true });
  }

  database.prepare("DELETE FROM repos WHERE name = ?").run(name);
  database.prepare("DELETE FROM repo_clone_queue WHERE repo_name = ?").run(name);
  return { name, deleted: true };
}

export async function retryClone(name) {
  const database = getDb();
  const repo = database.prepare("SELECT * FROM repos WHERE name = ?").get(name);
  if (!repo) throw new Error(`Repo "${name}" not found.`);
  if (repo.status !== "failed") throw new Error(`Repo "${name}" is not in failed state (current: ${repo.status}).`);

  database.prepare("UPDATE repos SET status = 'pulling', error_msg = '', updated_at = datetime('now') WHERE name = ?").run(name);
  database.prepare("DELETE FROM repo_clone_queue WHERE repo_name = ?").run(name);

  startClone(name).catch((error) => {
    console.error(`[repo] retry clone failed for ${name}:`, error.message);
  });

  return { name, status: "pulling" };
}

// --- Internal: Clone + Index ---

async function startClone(name) {
  const database = getDb();
  const repo = database.prepare("SELECT * FROM repos WHERE name = ?").get(name);
  if (!repo) return;

  const repoPath = join(REPO_DIR, name);
  let sshKeyPath = null;

  try {
    // Clean up any partial clone
    if (existsSync(repoPath)) {
      await rm(repoPath, { recursive: true, force: true });
    }

    await mkdir(repoPath, { recursive: true });

    const args = ["clone", "--progress"];
    if (repo.branch) args.push("--branch", repo.branch);
    if (repo.depth > 0) args.push("--depth", String(repo.depth));

    // Build authenticated URL
    const cloneUrl = buildCloneUrl(repo);

    args.push(cloneUrl, repoPath);

    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

    // SSH key handling
    if (isSshUrl(repo.url) && repo.ssh_key) {
      sshKeyPath = await writeSshKey(repo.ssh_key);
      env.GIT_SSH_COMMAND = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`;
    }

    // Git user config
    if (repo.username) env.GIT_AUTHOR_NAME = repo.username;
    if (repo.email) {
      env.GIT_AUTHOR_EMAIL = repo.email;
      env.GIT_COMMITTER_EMAIL = repo.email;
    }

    await runGit(args, env);

    // Clone succeeded
    database.prepare("UPDATE repos SET status = 'indexing', updated_at = datetime('now') WHERE name = ?").run(name);

    // Run codebase-memory-mcp index
    await runIndex(name, repoPath);

    database.prepare("UPDATE repos SET status = 'success', updated_at = datetime('now') WHERE name = ?").run(name);

  } catch (error) {
    database.prepare("UPDATE repos SET status = 'failed', error_msg = ?, updated_at = datetime('now') WHERE name = ?")
      .run(error.message, name);
  } finally {
    database.prepare("DELETE FROM repo_clone_queue WHERE repo_name = ?").run(name);
    if (sshKeyPath) {
      try { await unlink(sshKeyPath); } catch { /* ignore */ }
    }
  }
}

function buildCloneUrl(repo) {
  if (isSshUrl(repo.url)) return repo.url;

  try {
    const parsed = new URL(repo.url);
    if (repo.username && repo.password) {
      parsed.username = encodeURIComponent(repo.username);
      parsed.password = encodeURIComponent(repo.password);
    } else if (repo.token) {
      parsed.username = "oauth2";
      parsed.password = repo.token;
    }
    return parsed.toString();
  } catch {
    return repo.url;
  }
}

function isSshUrl(url) {
  return /^(git@|ssh:\/\/)/.test(String(url));
}

async function writeSshKey(key) {
  const keyPath = join(tmpdir(), `aibase-ssh-${randomUUID()}`);
  await writeFile(keyPath, key.trim() + "\n", { mode: 0o600 });
  return keyPath;
}

function runGit(args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", args, {
      cwd: REPO_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("Clone timed out after 5 minutes."));
    }, 5 * 60 * 1000);

    // Drain stdout to prevent buffer deadlock (git writes clone progress to stderr)
    child.stdout.on("data", () => {});

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`git failed to start: ${error.message}`));
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise();
      } else {
        const message = extractGitError(stderr) || `git exited with code ${code}`;
        reject(new Error(message));
      }
    });
  });
}

function extractGitError(stderr) {
  const lines = String(stderr).split("\n").filter(Boolean);
  // Look for common git error patterns
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("fatal:")) return trimmed.replace(/^fatal:\s*/, "");
    if (trimmed.startsWith("ERROR:")) return trimmed.replace(/^ERROR:\s*/, "");
    if (trimmed.includes("Permission denied")) return trimmed;
    if (trimmed.includes("could not read Username")) return "Authentication required. Provide username/password or token.";
    if (trimmed.includes("Could not resolve host")) return trimmed;
  }
  // Return last non-progress line
  const nonProgress = lines.filter((l) => !l.includes("%") && !l.includes("Receiving objects") && !l.includes("Resolving deltas"));
  return nonProgress.pop()?.trim() || "Clone failed.";
}

async function runIndex(name, repoPath) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      "cli",
      "index_repository",
      JSON.stringify({ repo_path: repoPath, mode: "full" }),
    ];

    const child = spawn("codebase-memory-mcp", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      console.warn(`[repo] index timed out for ${name}, skipping`);
      resolvePromise();
    }, 10 * 60 * 1000);

    // Must drain stdout to prevent buffer deadlock
    child.stdout.on("data", () => {});

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // If binary not found, mark as success anyway (MCP will index on first use)
      if (error.code === "ENOENT") {
        console.warn(`[repo] codebase-memory-mcp binary not found, skipping index for ${name}`);
        resolvePromise();
      } else {
        reject(new Error(`index failed: ${error.message}`));
      }
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise();
      } else {
        const message = stderr.trim() || `index exited with code ${code}`;
        console.warn(`[repo] index warning for ${name}: ${message}`);
        // Don't fail on index errors — the repo is still usable
        resolvePromise();
      }
    });
  });
}

function extractRepoName(url) {
  const raw = String(url).trim();

  // SSH: git@host:user/repo.git
  const sshMatch = raw.match(/^git@[^:]+:([^/]+\/.+)\.git$/);
  if (sshMatch) {
    return basename(sshMatch[1]);
  }

  // SSH short: git@host:user/repo (no .git)
  const sshMatch2 = raw.match(/^git@[^:]+:([^/]+\/([^/]+?))(?:\.git)?$/);
  if (sshMatch2) {
    return sshMatch2[2];
  }

  try {
    const parsed = new URL(raw);
    let pathname = parsed.pathname.replace(/\/$/, "");
    if (pathname.endsWith(".git")) pathname = pathname.slice(0, -4);
    return basename(pathname);
  } catch {
    // Last resort: grab last segment
    const cleaned = raw.replace(/\.git$/, "").replace(/\/$/, "");
    return basename(cleaned);
  }
}
