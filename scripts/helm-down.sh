#!/usr/bin/env bash
set -euo pipefail

RELEASE_NAME="${AIBASE_HELM_RELEASE:-aibase}"
NAMESPACE="${AIBASE_NAMESPACE:-aibase}"
DELETE_NAMESPACE="${AIBASE_DELETE_NAMESPACE:-0}"

helm uninstall "${RELEASE_NAME}" --namespace "${NAMESPACE}" --ignore-not-found

case "${DELETE_NAMESPACE}" in
  1|true|TRUE|yes|YES|on|ON)
    kubectl delete namespace "${NAMESPACE}" --ignore-not-found
    ;;
  *)
    echo "Namespace '${NAMESPACE}' kept. Set AIBASE_DELETE_NAMESPACE=1 to remove it."
    ;;
esac
