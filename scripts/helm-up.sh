#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_DIR="${ROOT_DIR}/charts/aibase"
LOCAL_VALUES="${CHART_DIR}/values-local.yaml"

RELEASE_NAME="${AIBASE_HELM_RELEASE:-aibase}"
NAMESPACE="${AIBASE_NAMESPACE:-aibase}"
IMAGE_REPOSITORY="${AIBASE_IMAGE_REPOSITORY:-aibase}"
IMAGE_TAG="${AIBASE_IMAGE_TAG:-local}"
IMAGE="${IMAGE_REPOSITORY}:${IMAGE_TAG}"
IMAGE_PULL_POLICY="${AIBASE_IMAGE_PULL_POLICY:-Never}"
OPENCODE_VERSION="${OPENCODE_VERSION:-latest}"
NODE_IMAGE="${AIBASE_NODE_IMAGE:-node:22-bookworm-slim}"
PULL_BASE_IMAGE="${AIBASE_PULL_BASE_IMAGE:-1}"

BUILD_IMAGE="${AIBASE_BUILD_IMAGE:-1}"
LOAD_IMAGE="${AIBASE_LOAD_IMAGE:-auto}"
PORT_FORWARD="${AIBASE_PORT_FORWARD:-1}"
LOCAL_PORT="${AIBASE_LOCAL_PORT:-3001}"
WAIT_TIMEOUT="${AIBASE_WAIT_TIMEOUT:-180s}"
ENABLE_PERSISTENCE="${AIBASE_PERSISTENCE:-0}"
EXTRA_VALUES="${AIBASE_HELM_VALUES:-}"
CREDENTIALS_SECRET="${AIBASE_CREDENTIALS_SECRET:-aibase-credentials}"
OPENCODE_PASSWORD="${AIBASE_OPENCODE_PASSWORD:-${OPENCODE_SERVER_PASSWORD:-}}"

PROVIDER_ENV_KEYS=(
  OPENCODE_CONFIG_CONTENT
  OPENCODE_MODEL
  OPENCODE_SMALL_MODEL
  OPENCODE_DEFAULT_AGENT
  OPENCODE_LOG_LEVEL
  OPENCODE_SHARE
  OPENCODE_AUTOUPDATE
  OPENCODE_SNAPSHOT
  OPENCODE_ENABLED_PROVIDERS
  OPENCODE_DISABLED_PROVIDERS
  AIBASE_PROMPT_STREAM_TIMEOUT_MS
  AIBASE_MCP_DIR
  AIBASE_MCP_AUTO_REGISTER
  AIBASE_MCP_UPLOAD_MAX_BYTES
  AIBASE_ENV_BASE_URL
  AIBASE_OPENCODE_MODEL
  AIBASE_OPENCODE_SMALL_MODEL
  AIBASE_OPENCODE_DEFAULT_AGENT
  AIBASE_OPENCODE_LOG_LEVEL
  AIBASE_OPENCODE_SHARE
  AIBASE_OPENCODE_AUTOUPDATE
  AIBASE_OPENCODE_SNAPSHOT
  AIBASE_OPENCODE_ENABLED_PROVIDERS
  AIBASE_OPENCODE_DISABLED_PROVIDERS
  AIBASE_OPENCODE_AGENT_JSON
  AIBASE_OPENCODE_COMMAND_JSON
  AIBASE_OPENCODE_EXPERIMENTAL_JSON
  AIBASE_OPENCODE_MCP_JSON
  AIBASE_OPENCODE_PERMISSION_JSON
  AIBASE_OPENCODE_PLUGIN_JSON
  AIBASE_OPENCODE_PROVIDER_JSON
  AIBASE_OPENCODE_TOOL_OUTPUT_JSON
  OPENAI_API_KEY
  OPENAI_BASE_URL
  AIBASE_OPENAI_API_KEY
  AIBASE_OPENAI_BASE_URL
  ANTHROPIC_API_KEY
  ANTHROPIC_BASE_URL
  AIBASE_ANTHROPIC_API_KEY
  AIBASE_ANTHROPIC_BASE_URL
  GOOGLE_GENERATIVE_AI_API_KEY
  GEMINI_API_KEY
  AIBASE_GOOGLE_GENERATIVE_AI_API_KEY
  AIBASE_GEMINI_API_KEY
  GROQ_API_KEY
  GROQ_BASE_URL
  AIBASE_GROQ_API_KEY
  AIBASE_GROQ_BASE_URL
  OPENROUTER_API_KEY
  OPENROUTER_BASE_URL
  AIBASE_OPENROUTER_API_KEY
  AIBASE_OPENROUTER_BASE_URL
  AZURE_OPENAI_API_KEY
  AZURE_OPENAI_ENDPOINT
  AZURE_OPENAI_API_VERSION
  AIBASE_AZURE_OPENAI_API_KEY
  AIBASE_AZURE_OPENAI_ENDPOINT
  AIBASE_AZURE_OPENAI_API_VERSION
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_SESSION_TOKEN
  AWS_REGION
  AWS_DEFAULT_REGION
  AIBASE_AWS_ACCESS_KEY_ID
  AIBASE_AWS_SECRET_ACCESS_KEY
  AIBASE_AWS_SESSION_TOKEN
  AIBASE_AWS_REGION
  AIBASE_AWS_DEFAULT_REGION
)

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

require_command() {
  if ! command_exists "$1"; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

prepare_base_image() {
  if ! is_truthy "${PULL_BASE_IMAGE}"; then
    echo "Skipping base image pull because AIBASE_PULL_BASE_IMAGE=${PULL_BASE_IMAGE}."
    return
  fi

  if docker image inspect "${NODE_IMAGE}" >/dev/null 2>&1; then
    echo "Base image ${NODE_IMAGE} is already available locally."
    return
  fi

  echo "Pulling base image ${NODE_IMAGE} before build..."
  docker pull "${NODE_IMAGE}"
}

fullname() {
  if [[ -n "${AIBASE_SERVICE_NAME:-}" ]]; then
    printf '%s\n' "${AIBASE_SERVICE_NAME}"
  elif [[ "${RELEASE_NAME}" == *aibase* ]]; then
    printf '%s\n' "${RELEASE_NAME}"
  else
    printf '%s-aibase\n' "${RELEASE_NAME}"
  fi
}

load_image_into_cluster() {
  local context
  context="$(kubectl config current-context)"

  case "${LOAD_IMAGE}" in
    0|false|FALSE|never|Never)
      echo "Skipping image load because AIBASE_LOAD_IMAGE=${LOAD_IMAGE}."
      return
      ;;
    kind)
      require_command kind
      kind load docker-image "${IMAGE}" --name "${KIND_CLUSTER_NAME:-${context#kind-}}"
      return
      ;;
    minikube)
      require_command minikube
      minikube image load "${IMAGE}"
      return
      ;;
    auto)
      if [[ "${context}" == kind-* ]]; then
        require_command kind
        kind load docker-image "${IMAGE}" --name "${KIND_CLUSTER_NAME:-${context#kind-}}"
      elif [[ "${context}" == *minikube* ]] && command_exists minikube; then
        minikube image load "${IMAGE}"
      else
        echo "Assuming Kubernetes context '${context}' can see local image ${IMAGE}."
        echo "If the Pod cannot find the image, set AIBASE_LOAD_IMAGE=kind|minikube or push to a registry."
      fi
      return
      ;;
    *)
      echo "Unsupported AIBASE_LOAD_IMAGE=${LOAD_IMAGE}; use auto, kind, minikube, or never." >&2
      exit 1
      ;;
  esac
}

create_credentials_secret_if_needed() {
  local secret_file has_secret
  secret_file="$(mktemp)"
  has_secret=0
  chmod 600 "${secret_file}"

  for key in "${PROVIDER_ENV_KEYS[@]}"; do
    if [[ -n "${!key:-}" ]]; then
      printf '%s=%s\n' "${key}" "${!key}" >>"${secret_file}"
      has_secret=1
    fi
  done

  if [[ -n "${OPENCODE_PASSWORD}" ]]; then
    printf 'OPENCODE_SERVER_PASSWORD=%s\n' "${OPENCODE_PASSWORD}" >>"${secret_file}"
    has_secret=1
  fi

  if [[ "${has_secret}" -eq 0 ]]; then
    rm -f "${secret_file}"
    return 1
  fi

  kubectl -n "${NAMESPACE}" create secret generic "${CREDENTIALS_SECRET}" \
    --from-env-file="${secret_file}" \
    --dry-run=client \
    -o yaml | kubectl apply -f -
  rm -f "${secret_file}"
  return 0
}

main() {
  require_command kubectl
  require_command helm

  kubectl cluster-info >/dev/null
  kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

  if is_truthy "${BUILD_IMAGE}"; then
    require_command docker
    prepare_base_image
    echo "Building ${IMAGE} with base ${NODE_IMAGE} and opencode ${OPENCODE_VERSION}..."
    docker build \
      --pull=false \
      --build-arg "NODE_IMAGE=${NODE_IMAGE}" \
      --build-arg "OPENCODE_VERSION=${OPENCODE_VERSION}" \
      -t "${IMAGE}" \
      "${ROOT_DIR}"
    load_image_into_cluster
  else
    echo "Skipping docker build because AIBASE_BUILD_IMAGE=${BUILD_IMAGE}."
  fi

  local helm_args service_name has_credentials_secret
  service_name="$(fullname)"
  helm_args=(
    upgrade --install "${RELEASE_NAME}" "${CHART_DIR}"
    --namespace "${NAMESPACE}"
    --create-namespace
    --values "${LOCAL_VALUES}"
    --set-string "image.repository=${IMAGE_REPOSITORY}"
    --set-string "image.tag=${IMAGE_TAG}"
    --set-string "image.pullPolicy=${IMAGE_PULL_POLICY}"
  )

  if [[ -n "${EXTRA_VALUES}" ]]; then
    helm_args+=(--values "${EXTRA_VALUES}")
  fi

  if is_truthy "${ENABLE_PERSISTENCE}"; then
    helm_args+=(
      --set "persistence.workspace.enabled=true"
      --set "persistence.opencodeData.enabled=true"
      --set "persistence.skills.enabled=true"
      --set "persistence.mcp.enabled=true"
    )
  fi

  if create_credentials_secret_if_needed; then
    has_credentials_secret=1
  else
    has_credentials_secret=0
  fi

  if [[ "${has_credentials_secret}" -eq 1 ]]; then
    helm_args+=(--set-string "credentials.existingSecret=${CREDENTIALS_SECRET}")
  fi

  if [[ -n "${OPENCODE_PASSWORD}" ]]; then
    helm_args+=(
      --set "opencode.serverAuth.enabled=true"
      --set-string "opencode.serverAuth.existingSecret=${CREDENTIALS_SECRET}"
    )
  fi

  echo "Installing Helm release ${RELEASE_NAME} in namespace ${NAMESPACE}..."
  helm "${helm_args[@]}"

  if is_truthy "${BUILD_IMAGE}"; then
    echo "Restarting deployment/${service_name} so Kubernetes picks up rebuilt image ${IMAGE}..."
    kubectl -n "${NAMESPACE}" rollout restart "deployment/${service_name}"
  fi

  echo "Waiting for deployment/${service_name}..."
  kubectl -n "${NAMESPACE}" rollout status "deployment/${service_name}" --timeout="${WAIT_TIMEOUT}"

  kubectl -n "${NAMESPACE}" get pods -l "app.kubernetes.io/instance=${RELEASE_NAME}"

  if is_truthy "${PORT_FORWARD}"; then
    echo
    echo "Aibase is available at http://127.0.0.1:${LOCAL_PORT}"
    echo "Press Ctrl-C to stop port-forwarding. The Helm release will keep running."
    kubectl -n "${NAMESPACE}" port-forward "svc/${service_name}" "${LOCAL_PORT}:80"
  else
    echo "Port-forward disabled. Run:"
    echo "  kubectl -n ${NAMESPACE} port-forward svc/${service_name} ${LOCAL_PORT}:80"
  fi
}

main "$@"
