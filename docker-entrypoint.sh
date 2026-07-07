#!/usr/bin/env bash
set -euo pipefail

OMO_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
OMO_CONFIG_FILE="$OMO_CONFIG_DIR/oh-my-openagent.jsonc"

ULTRA_MODEL="${OMO_DEFAULT_ULTRA_MODEL:-customkimi/kimi-for-coding}"
LITE_MODEL="${OMO_DEFAULT_LITE_MODEL:-opencode-zen/deepseek-v4-flash-free}"

if [[ -f "$OMO_CONFIG_FILE" && "${OMO_GENERATE_CONFIG:-false}" != "true" ]]; then
  echo "[entrypoint] $OMO_CONFIG_FILE already exists, skipping generation"
else
  echo "[entrypoint] generating $OMO_CONFIG_FILE (ultra=$ULTRA_MODEL lite=$LITE_MODEL)"
  mkdir -p "$OMO_CONFIG_DIR"
  cat > "$OMO_CONFIG_FILE" <<JSONC
{
  "\$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/dev/assets/oh-my-opencode.schema.json",
  "agents": {
    "sisyphus": { "model": "$ULTRA_MODEL" },
    "hephaestus": { "model": "$ULTRA_MODEL", "reasoningEffort": "high", "textVerbosity": "medium", "maxTokens": 32000 },
    "oracle": { "model": "$LITE_MODEL", "reasoningEffort": "high", "textVerbosity": "high", "maxTokens": 24000 },
    "librarian": { "model": "$LITE_MODEL", "maxTokens": 12000 },
    "explore": { "model": "$LITE_MODEL", "maxTokens": 10000 },
    "atlas": { "model": "$LITE_MODEL", "maxTokens": 20000 },
    "multimodal-looker": { "model": "$LITE_MODEL", "maxTokens": 20000 },
    "prometheus": { "model": "$LITE_MODEL" },
    "metis": { "model": "$LITE_MODEL" },
    "momus": { "model": "$LITE_MODEL" },
    "sisyphus-junior": { "model": "$LITE_MODEL" }
  },
  "categories": {
    "quick": { "model": "$LITE_MODEL", "maxTokens": 8000 },
    "unspecified-low": { "model": "$LITE_MODEL", "maxTokens": 16000 },
    "unspecified-high": { "model": "$LITE_MODEL", "maxTokens": 24000 },
    "deep": { "model": "$LITE_MODEL", "maxTokens": 32000 },
    "ultrabrain": { "model": "$LITE_MODEL", "maxTokens": 32000 },
    "visual-engineering": { "model": "$LITE_MODEL", "maxTokens": 20000 },
    "artistry": { "model": "$LITE_MODEL", "maxTokens": 20000 },
    "writing": { "model": "$LITE_MODEL", "maxTokens": 12000 }
  }
}
JSONC
fi

exec "$@"
