# Aibase Helm Chart

This chart deploys Aibase as a single container. The container starts the Aibase Web service and runs `opencode serve` as an internal kernel process.

Only Aibase is exposed through the Kubernetes Service. The opencode server listens on `127.0.0.1` inside the Pod.

## Install

For local development, the repository root has a one-command wrapper:

```bash
task helm-up
```

It builds the image, loads it into kind or minikube when detected, installs this chart, waits for readiness, and port-forwards the Service to `http://127.0.0.1:3001`.

To remove it:

```bash
task helm-down
```

Install manually with an image you already pushed:

```bash
helm upgrade --install aibase charts/aibase \
  --set image.repository=registry.example.com/aibase \
  --set image.tag=0.1.0
```

## Credentials

Use an existing Secret when possible:

```bash
kubectl create secret generic aibase-credentials \
  --from-literal=AIBASE_OPENCODE_MODEL='openai/<model-id>' \
  --from-literal=AIBASE_OPENAI_API_KEY="$OPENAI_API_KEY" \
  --from-literal=AIBASE_ENV_BASE_URL='http://api.example.com/api/v1'

helm upgrade --install aibase charts/aibase \
  --set image.repository=registry.example.com/aibase \
  --set image.tag=0.1.0 \
  --set credentials.existingSecret=aibase-credentials
```

The Secret is exposed as environment variables in the Pod. Aibase converts common `AIBASE_OPENCODE_*` variables into opencode config and normalizes provider aliases such as `AIBASE_OPENAI_API_KEY` to `OPENAI_API_KEY` before launching `opencode serve`.

Common variables:

```bash
AIBASE_OPENCODE_MODEL=openai/<model-id>
AIBASE_OPENCODE_SMALL_MODEL=openai/<small-model-id>
AIBASE_OPENCODE_DEFAULT_AGENT=build
AIBASE_OPENCODE_LOG_LEVEL=INFO
AIBASE_OPENCODE_SHARE=disabled
AIBASE_OPENAI_API_KEY=...
AIBASE_ANTHROPIC_API_KEY=...
AIBASE_GEMINI_API_KEY=...
AIBASE_GROQ_API_KEY=...
AIBASE_OPENROUTER_API_KEY=...
AIBASE_ENV_BASE_URL=http://api.example.com/api/v1
```

## Persistence

Enable PVCs for workspace and opencode data:

```bash
helm upgrade --install aibase charts/aibase \
  --set image.repository=registry.example.com/aibase \
  --set image.tag=0.1.0 \
  --set persistence.workspace.enabled=true \
  --set persistence.opencodeData.enabled=true \
  --set persistence.skills.enabled=true \
  --set persistence.mcp.enabled=true
```

`persistence.skills.enabled=true` stores skills uploaded from the Aibase Web UI. The chart seeds an empty skills PVC from the skills baked into the image before the main container starts.

`persistence.mcp.enabled=true` stores MCP/OpenAPI documents uploaded from the Aibase Web UI. The chart seeds an empty MCP PVC from the `mcp/` documents baked into the image before the main container starts.

## MCP

The image includes a local `aibase_openapi` MCP server. It is auto-registered into the opencode config when `env.AIBASE_MCP_AUTO_REGISTER=true`, parses Markdown OpenAPI documents from `env.AIBASE_MCP_DIR`, and exposes those interfaces as callable tools.

Use `env.AIBASE_ENV_BASE_URL` to point uploaded OpenAPI documents at a concrete environment. Gateway auth can be supplied through the generic auth provider variables (`AIBASE_API_AUTH_TYPE`, `AIBASE_API_AUTH_TOKEN`, etc.).

## Important Values

| Value | Default | Purpose |
| --- | --- | --- |
| `image.repository` | `aibase` | Container image repository |
| `image.tag` | chart app version | Container image tag |
| `env.AIBASE_WORKSPACE` | `/workspace` | Working directory passed to opencode |
| `env.AIBASE_SKILLS_DIR` | `/app/skills` | Project skill directory |
| `env.AIBASE_MCP_DIR` | `/app/mcp` | Project MCP/OpenAPI document directory |
| `env.AIBASE_MCP_AUTO_REGISTER` | `true` | Register the built-in `aibase_openapi` MCP server |
| `env.AIBASE_ENV_BASE_URL` | empty | OpenAPI document environment base URL |
| `env.AIBASE_PROMPT_STREAM_TIMEOUT_MS` | `600000` | Maximum duration for one Aibase prompt stream |
| `credentials.items` | `{}` | Managed Secret key/value env vars for opencode model and provider keys |
| `opencode.serverAuth.enabled` | `false` | Enable internal opencode Basic Auth |
| `credentials.existingSecret` | empty | Secret exposed to the Pod with provider keys |
| `persistence.workspace.enabled` | `false` | Create and mount a workspace PVC |
| `persistence.opencodeData.enabled` | `false` | Persist opencode data and sessions |
| `persistence.skills.enabled` | `false` | Persist skills uploaded through the Web UI |
| `persistence.mcp.enabled` | `false` | Persist MCP/OpenAPI docs uploaded through the Web UI |
| `ingress.enabled` | `false` | Create an Ingress |
