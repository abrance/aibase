import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const supportedExtensions = new Set([".json"]);

/**
 * Read all agent definitions from the agents directory synchronously.
 * Returns an object where keys are agent names and values are the parsed
 * agent configurations, suitable for merging into opencode's `agent` config.
 *
 * @param {string} agentsRoot - Absolute path to the agents directory
 * @returns {Record<string, object>} Agent name → agent config map
 */
export function readAgentsSync(agentsRoot) {
  if (!existsSync(agentsRoot)) return {};

  const entries = readdirSync(agentsRoot, { withFileTypes: true });
  const result = {};

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!supportedExtensions.has(extname(entry.name).toLowerCase())) continue;

    const name = entry.name.replace(/\.json$/i, "");
    const path = join(agentsRoot, entry.name);

    try {
      const content = readFileSync(path, "utf8");
      const data = JSON.parse(content);
      if (data && typeof data === "object") {
        result[name] = data;
      }
    } catch {
      // Skip invalid or unparseable files
    }
  }

  return result;
}

/**
 * Read a single agent definition.
 *
 * @param {string} agentsRoot
 * @param {string} name - Agent name
 * @returns {Promise<object|null>}
 */
export async function readAgent(agentsRoot, name) {
  const path = join(agentsRoot, `${sanitizeName(name)}.json`);
  if (!existsSync(path)) return null;
  const content = await readFile(path, "utf8");
  return JSON.parse(content);
}

/**
 * Create or update an agent JSON file.
 *
 * @param {string} agentsRoot
 * @param {string} name - Agent name (slug)
 * @param {object} data - Agent configuration
 * @returns {Promise<{name: string}>}
 */
export async function writeAgent(agentsRoot, name, data) {
  const cleanName = sanitizeName(name);
  if (!cleanName) {
    throw new Error(
      "Invalid agent name. Use lowercase letters, numbers, and hyphens only.",
    );
  }

  await mkdir(agentsRoot, { recursive: true });
  const path = join(agentsRoot, `${cleanName}.json`);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  return { name: cleanName };
}

/**
 * Delete an agent JSON file.
 *
 * @param {string} agentsRoot
 * @param {string} name - Agent name
 * @returns {Promise<boolean>} Whether the file existed and was deleted
 */
export async function deleteAgent(agentsRoot, name) {
  const cleanName = sanitizeName(name);
  const path = join(agentsRoot, `${cleanName}.json`);
  if (!existsSync(path)) return false;
  await unlink(path);
  return true;
}

const agentNamePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Validate whether an agent name conforms to the expected format.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isValidAgentName(value) {
  return agentNamePattern.test(value);
}

/**
 * Sanitize a string into a valid agent name (lowercase slug).
 *
 * @param {string} value
 * @returns {string}
 */
export function sanitizeName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "unnamed-agent";
}
