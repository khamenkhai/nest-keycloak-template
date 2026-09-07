#!/usr/bin/env bash
set -euo pipefail

VERSION="$(git rev-parse --short HEAD)"
APP_VERSION="$(node -p "require('./package.json').version")"
LOCAL_REGISTRY="${LOCAL_REGISTRY:-68.168.216.198:5050}"
IMAGE_NAME="${IMAGE_NAME:-cannopy-nest-template}"
REGISTRY_IMAGE="${LOCAL_REGISTRY%/}/${IMAGE_NAME}"

echo "Building and pushing Docker image tags:"
echo "  ${REGISTRY_IMAGE}:${VERSION}"
echo "  ${REGISTRY_IMAGE}:${APP_VERSION}"

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t "${REGISTRY_IMAGE}:${VERSION}" \
  -t "${REGISTRY_IMAGE}:${APP_VERSION}" \
  --push \
  .
