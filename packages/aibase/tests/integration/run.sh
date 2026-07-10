#!/usr/bin/env bash
# run.sh — one-command integration test harness for Docker.
#
# Builds the aibase image, starts aibase + test containers,
# waits for tests to complete, then tears down.
#
# Usage:
#   bash tests/integration/run.sh                      # full test with paid model
#   AIBASE_TEST_SKIP_LLM=1 bash tests/integration/run.sh  # skip LLM tests
#
#   # Custom model:
#   AIBASE_TEST_MODEL=anthropic/claude-haiku-4 bash tests/integration/run.sh
#
#   # Custom provider config (provider JSON):
#   AIBASE_OPENCODE_PROVIDER_JSON='{"customkimi":{...}}' bash tests/integration/run.sh
#
#   # Full opencode config override:
#   AIBASE_TEST_OPENCODE_CONFIG='{"model":"customkimi/kimi-for-coding","provider":{...}}' bash tests/integration/run.sh
#
#   # Provider API key (for custom provider):
#   AIBASE_TEST_PROVIDER_API_KEY=sk-xxx bash tests/integration/run.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

# ─── Defaults ──────────────────────────────────────────────
# Paid model as default — no more free-tier rate limits.
export AIBASE_TEST_SKIP_LLM="${AIBASE_TEST_SKIP_LLM:-0}"
export AIBASE_TEST_MODEL="${AIBASE_TEST_MODEL:-customkimi/kimi-for-coding}"
export AIBASE_OPENCODE_MODEL="${AIBASE_OPENCODE_MODEL:-${AIBASE_TEST_MODEL}}"

# Full opencode config override — takes precedence over individual vars.
if [ -n "${AIBASE_TEST_OPENCODE_CONFIG:-}" ]; then
  export OPENCODE_CONFIG_CONTENT="${AIBASE_TEST_OPENCODE_CONFIG}"
fi

echo "=== Aibase Integration Test Runner ==="
echo "  model:       ${AIBASE_TEST_MODEL}"
echo "  skip LLM:    ${AIBASE_TEST_SKIP_LLM}"
if [ -n "${OPENCODE_CONFIG_CONTENT:-}" ]; then
  echo "  config:      OPENCODE_CONFIG_CONTENT provided (${#OPENCODE_CONFIG_CONTENT} chars)"
fi
echo "  compose:     ${COMPOSE_FILE}"
echo ""

cd "$PROJECT_ROOT"

# ─── Cleanup on exit ───────────────────────────────────────
cleanup() {
  echo ""
  echo "=== Tearing down ==="
  docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

# ─── Build & Run ───────────────────────────────────────────
echo "=== Building aibase image ==="
DOCKER_BUILDKIT=0 COMPOSE_DOCKER_CLI_BUILD=0 docker compose -f "$COMPOSE_FILE" build aibase

echo ""
echo "=== Starting services + running tests ==="
docker compose -f "$COMPOSE_FILE" up \
  --abort-on-container-exit \
  --exit-code-from test \
  --remove-orphans

# Exit code flows from docker compose (propagates test container exit code)
