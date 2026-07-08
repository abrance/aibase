#!/usr/bin/env bash
# run.sh — one-command integration test harness for Docker.
#
# Builds the aibase image, starts aibase + test containers,
# waits for tests to complete, then tears down.
#
# Usage:
#   bash tests/integration/run.sh                    # skip LLM tests
#   AIBASE_TEST_SKIP_LLM=0 bash tests/integration/run.sh  # full test
#
#   # With API keys:
#   OPENAI_API_KEY=sk-xxx bash tests/integration/run.sh
#   # Or via .env:
#   cp .env.example .env && bash tests/integration/run.sh
#
#   # Custom model:
#   AIBASE_TEST_MODEL=anthropic/claude-haiku-4 bash tests/integration/run.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

# ─── Defaults ──────────────────────────────────────────────
export AIBASE_TEST_SKIP_LLM="${AIBASE_TEST_SKIP_LLM:-1}"
export AIBASE_TEST_MODEL="${AIBASE_TEST_MODEL:-opencode/deepseek-v4-flash-free}"
export AIBASE_OPENCODE_MODEL="${AIBASE_OPENCODE_MODEL:-${AIBASE_TEST_MODEL}}"

echo "=== Aibase Integration Test Runner ==="
echo "  model:       ${AIBASE_TEST_MODEL}"
echo "  skip LLM:    ${AIBASE_TEST_SKIP_LLM}"
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
