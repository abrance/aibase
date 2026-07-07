# Aibase

Aibase is a small Web service that presents a Aibase-branded browser UI while using a local `opencode serve` process as its coding kernel.

The service starts opencode itself and exposes a narrow Aibase API for sessions, prompts, and skill discovery.

## Requirements

- Node.js 20 or newer
- `opencode` available on `PATH`

The current local command detected during scaffolding was:

```bash
/Users/amazingblues/.opencode/bin/opencode
```

## Run

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3001
```

Useful environment variables:

```bash
AIBASE_HOST=127.0.0.1
AIBASE_PORT=3001
AIBASE_WORKSPACE=/path/to/workspace
AIBASE_SKILLS_DIR=/path/to/skills
AIBASE_MCP_DIR=/path/to/mcp
OPENCODE_BIN=opencode
OPENCODE_HOST=127.0.0.1
OPENCODE_PORT=4096
AIBASE_PROMPT_STREAM_TIMEOUT_MS=600000
```

Leave `OPENCODE_PORT` unset to let Aibase choose a free internal port. Set it when you need a stable opencode port. Aibase prints both the public Aibase URL and the internal opencode URL when it starts.

## Container

The image runs Aibase as the foreground process and starts `opencode serve` inside the same container. Aibase is exposed on `0.0.0.0:3001`; the opencode kernel stays on `127.0.0.1` inside the container.

Build:

```bash
docker build -t aibase:0.1.0 .
```

Pin a specific opencode version at build time:

```bash
docker build --build-arg OPENCODE_VERSION=1.14.39 -t aibase:0.1.0 .
```

The image also installs the `oh-my-openagent` OpenCode plugin at build time. You can control the installation with these build arguments:

| Build arg | Default | Description |
| --- | --- | --- |
| `OMO_VERSION` | `latest` | oh-my-openagent version to install |
| `OMO_SUBSCRIPTIONS` | all providers disabled | Subscription flags passed to the installer |

For example, enable Claude and OpenAI subscriptions:

```bash
docker build \
  --build-arg OMO_SUBSCRIPTIONS="--claude=yes --openai=yes --gemini=no --copilot=no --opencode-zen=no --zai-coding-plan=no --opencode-go=no --kimi-for-coding=no --vercel-ai-gateway=no" \
  -t aibase:0.1.0 .
```

Provider credentials are not baked into the image; configure them at runtime with the usual `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.

Run locally:

```bash
docker run --rm \
  -p 3001:3001 \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -v "$PWD:/workspace" \
  aibase:0.1.0
```

Open:

```text
http://127.0.0.1:3001
```

## Helm

The chart lives in `charts/aibase`.

### Local one-command

With a local Kubernetes context selected, run:

```bash
task helm-up
```

Or:

```bash
npm run helm:up
```

This does the local loop end to end:

1. Builds `aibase:local`, including `opencode` in the image.
2. Loads the image into kind or minikube when those contexts are detected.
3. Installs or upgrades the Helm release.
4. Waits for the Pod to become ready.
5. Port-forwards the Service to `http://127.0.0.1:3001`.

Common local knobs:

```bash
# Use a different local port
AIBASE_LOCAL_PORT=3002 task helm-up

# Pin opencode during the image build
OPENCODE_VERSION=1.14.39 task helm-up

# Use another base image if Docker Hub mirrors are unhappy
AIBASE_NODE_IMAGE=node:20-bookworm-slim task helm-up

# Skip the pre-build base image pull
AIBASE_PULL_BASE_IMAGE=0 task helm-up

# Pass provider credentials into a local Kubernetes Secret
OPENAI_API_KEY="$OPENAI_API_KEY" task helm-up

# Configure opencode model and key through Aibase-prefixed env vars
AIBASE_OPENCODE_MODEL=openai/<model-id> \
AIBASE_OPENAI_API_KEY="$OPENAI_API_KEY" \
task helm-up

# Or use standard provider env vars directly
OPENCODE_MODEL=anthropic/<model-id> \
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
task helm-up

# Enable internal opencode Basic Auth
AIBASE_OPENCODE_PASSWORD=dev-secret task helm-up

# Keep workspace, opencode data, uploaded skills, and uploaded MCP docs on PVCs
AIBASE_PERSISTENCE=1 task helm-up

# Use a pushed image instead of building locally
AIBASE_BUILD_IMAGE=0 \
AIBASE_IMAGE_REPOSITORY=registry.example.com/aibase \
AIBASE_IMAGE_TAG=0.1.0 \
AIBASE_IMAGE_PULL_POLICY=IfNotPresent \
task helm-up
```

Stop and remove the local Helm release:

```bash
task helm-down
```

If the local cluster cannot see the image, set:

```bash
AIBASE_LOAD_IMAGE=kind task helm-up
# or
AIBASE_LOAD_IMAGE=minikube task helm-up
```

Install with an image you already pushed:

```bash
helm upgrade --install aibase charts/aibase \
  --set image.repository=registry.example.com/aibase \
  --set image.tag=0.1.0
```

Use an existing Kubernetes Secret for model/provider credentials:

```bash
kubectl create secret generic aibase-credentials \
  --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY"

helm upgrade --install aibase charts/aibase \
  --set image.repository=registry.example.com/aibase \
  --set image.tag=0.1.0 \
  --set credentials.existingSecret=aibase-credentials
```

Enable persistence for the workspace and opencode session data:

```bash
helm upgrade --install aibase charts/aibase \
  --set image.repository=registry.example.com/aibase \
  --set image.tag=0.1.0 \
  --set persistence.workspace.enabled=true \
  --set persistence.opencodeData.enabled=true \
  --set persistence.skills.enabled=true \
  --set persistence.mcp.enabled=true
```

Expose through Ingress:

```bash
helm upgrade --install aibase charts/aibase \
  --set image.repository=registry.example.com/aibase \
  --set image.tag=0.1.0 \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.hosts[0].host=aibase.example.com
```

Protect the internal opencode server with Basic Auth:

```bash
helm upgrade --install aibase charts/aibase \
  --set image.repository=registry.example.com/aibase \
  --set image.tag=0.1.0 \
  --set opencode.serverAuth.enabled=true \
  --set opencode.serverAuth.password='change-me'
```

When `opencode.serverAuth.enabled=true`, Aibase automatically sends the internal Basic Auth header while proxying to opencode.

### opencode environment

Aibase starts `opencode serve` inside the same process tree and builds the final opencode config from environment variables plus the project `skills/` path. Environment variables win over values already present in `OPENCODE_CONFIG_CONTENT`, while `skills.paths` is always extended with the mounted Aibase skills directory.

Common model/config variables:

```bash
AIBASE_OPENCODE_MODEL=openai/<model-id>
AIBASE_OPENCODE_SMALL_MODEL=openai/<small-model-id>
AIBASE_OPENCODE_DEFAULT_AGENT=build
AIBASE_OPENCODE_LOG_LEVEL=INFO
AIBASE_OPENCODE_SHARE=disabled
AIBASE_OPENCODE_AUTOUPDATE=false
AIBASE_OPENCODE_SNAPSHOT=true
AIBASE_OPENCODE_ENABLED_PROVIDERS=openai,anthropic
AIBASE_OPENCODE_DISABLED_PROVIDERS=groq
```

Provider keys can use either the standard provider name or a Aibase-prefixed alias. Aibase normalizes aliases before launching opencode:

```bash
# OpenAI-compatible
OPENAI_API_KEY=...
OPENAI_BASE_URL=...
AIBASE_OPENAI_API_KEY=...
AIBASE_OPENAI_BASE_URL=...

# Anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_BASE_URL=...
AIBASE_ANTHROPIC_API_KEY=...
AIBASE_ANTHROPIC_BASE_URL=...

# Gemini / Google
GOOGLE_GENERATIVE_AI_API_KEY=...
GEMINI_API_KEY=...
AIBASE_GOOGLE_GENERATIVE_AI_API_KEY=...
AIBASE_GEMINI_API_KEY=...

# Groq
GROQ_API_KEY=...
GROQ_BASE_URL=...
AIBASE_GROQ_API_KEY=...
AIBASE_GROQ_BASE_URL=...

# OpenRouter
OPENROUTER_API_KEY=...
OPENROUTER_BASE_URL=...
AIBASE_OPENROUTER_API_KEY=...
AIBASE_OPENROUTER_BASE_URL=...

# Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_API_VERSION=...
AIBASE_AZURE_OPENAI_API_KEY=...
AIBASE_AZURE_OPENAI_ENDPOINT=...
AIBASE_AZURE_OPENAI_API_VERSION=...

# AWS / Bedrock-style credentials
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...
AWS_REGION=...
AWS_DEFAULT_REGION=...
AIBASE_AWS_ACCESS_KEY_ID=...
AIBASE_AWS_SECRET_ACCESS_KEY=...
AIBASE_AWS_SESSION_TOKEN=...
AIBASE_AWS_REGION=...
AIBASE_AWS_DEFAULT_REGION=...
```

Advanced opencode config can be passed as JSON environment variables:

```bash
AIBASE_OPENCODE_PROVIDER_JSON='{"openai":{"options":{}}}'
AIBASE_OPENCODE_PERMISSION_JSON='{"bash":{"*":"ask"},"edit":"allow"}'
AIBASE_OPENCODE_TOOL_OUTPUT_JSON='{"max_lines":200,"max_bytes":8192}'
AIBASE_OPENCODE_MCP_JSON='{"playwright":{"type":"local","command":["npx","-y","@playwright/mcp"],"enabled":true}}'
AIBASE_OPENCODE_PLUGIN_JSON='["opencode-gemini-auth"]'
AIBASE_OPENCODE_AGENT_JSON='{"reviewer":{"mode":"subagent","description":"Reviews changes"}}'
AIBASE_OPENCODE_COMMAND_JSON='{"deploy":{"description":"Deploy app","prompt":"Deploy the current app"}}'
AIBASE_OPENCODE_EXPERIMENTAL_JSON='{"mcp_timeout":30000}'
```

You can also pass raw opencode config:

```bash
OPENCODE_CONFIG_CONTENT='{"model":"openai/<model-id>","small_model":"openai/<small-model-id>"}' task helm-up
```

For local `task helm-up`, all variables above are copied into the Kubernetes Secret named by `AIBASE_CREDENTIALS_SECRET` (default `aibase-credentials`) when they are set in your shell.

For production Helm, prefer an existing Secret:

```bash
kubectl create secret generic aibase-credentials \
  --from-literal=AIBASE_OPENCODE_MODEL='openai/<model-id>' \
  --from-literal=AIBASE_OPENAI_API_KEY='replace-me'

helm upgrade --install aibase charts/aibase \
  --set image.repository=registry.example.com/aibase \
  --set image.tag=0.1.0 \
  --set credentials.existingSecret=aibase-credentials
```

## Skills

The image starts with no built-in skills. Add your own by placing them under:

```text
skills/<skill-name>/SKILL.md
```

The service starts opencode with `skills.paths` pointing at the absolute `skills/` directory and every immediate `skills/*` folder that contains `SKILL.md`, then reads `/skill` from the opencode API. The UI also has a local fallback parser so you can still see project skills if the opencode skill endpoint is temporarily unavailable.

The Skills panel accepts `.zip` uploads. Each archive must contain a `SKILL.md` at its root, or inside one top-level skill folder. Aibase reads the `name` field from `SKILL.md`, extracts the archive to `skills/<name>`, overwrites an existing folder with the same name, and restarts the internal opencode process so the updated skill is immediately available.

For Helm deployments, enable `persistence.skills.enabled=true` when uploaded skills should survive Pod replacement. The chart seeds the skills PVC with the skills baked into the image the first time the PVC is empty.

Example:

```markdown
---
name: my-skill
description: Use when this project needs a focused workflow.
---

## Workflow

1. Inspect the current files.
2. Make the smallest useful change.
3. Verify locally.
```

## MCP

Aibase can host Markdown OpenAPI documents as callable MCP tools. Drop a `.md` or `.markdown` document onto the MCP panel in the Web UI; it is stored under `mcp/`, parsed into tools, and the internal opencode process is restarted. Alternatively, configure MCP servers directly via `AIBASE_OPENCODE_MCP_JSON`.

If an uploaded OpenAPI document contains absolute URLs that should point at a different environment, set `AIBASE_ENV_BASE_URL`. When the base URL contains only a scheme and host, the original API path is kept. When it includes a path, the original path is appended to that base path.

Gateway authentication headers can be supplied per-request by the MCP server implementation, or configured via the auth provider environment variables (`AIBASE_API_AUTH_TYPE`, etc.) if supported.

## Marketplace

Aibase includes a built-in marketplace registry under `registry/`.

- `registry/index.json` is the marketplace catalog.
- `registry/bundles/*.zip` stores bundle archives.
- Each bundle archive must include a root `bundle.json` manifest.
- Skill items in marketplace bundles should point at a `.zip` payload so the current installer receives a file buffer.

`bundle.json` describes what the bundle installs. Each item needs:

- `type` — `skill`, `mcp`, `agent`, or `knowledge`
- `source` — path inside the bundle archive
- `target` — install target name

Example manifest layout:

```json
{
  "schemaVersion": "1",
  "id": "example-bundle",
  "items": [
    { "id": "example-skill", "type": "skill", "source": "skills/example", "target": "example" },
    { "id": "example-mcp", "type": "mcp", "source": "mcp/example.md", "target": "example" }
  ]
}
```

The built-in starter bundle shows the minimal registry shape and includes more than one asset type so install verification has something real to check.

### Uploading bundles

Use the marketplace upload flow to add a bundle archive to `registry/bundles/` and upsert its listing into `registry/index.json`.

### Installing bundles

Installing a bundle reads the catalog entry from `registry/index.json`, loads the referenced archive from `registry/bundles/`, and dispatches each item to the existing skill / MCP / agent / knowledge installers.

Bundles that contain restart-requiring asset types trigger the normal runtime restart flow after install.

## API

- `GET /api/health`
- `GET /api/skills`
- `POST /api/skills/upload`
- `GET /api/mcp`
- `POST /api/mcp/upload`
- `GET /api/sessions`
- `POST /api/sessions`
- `PATCH /api/sessions/:id/title`
- `PATCH /api/sessions/:id/archive`
- `GET /api/sessions/:id/messages`
- `POST /api/sessions/:id/prompt`
- `POST /api/sessions/:id/prompt/stream`
- `ANY /api/opencode/*` for raw opencode API passthrough during debugging

## Check

```bash
npm run check
```
