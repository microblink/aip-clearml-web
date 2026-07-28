#!/usr/bin/env bash
# Build clearml-web inside Docker and push the webserver overlay image.
set -euo pipefail

cd "$(dirname "$0")"

BRANCH=$(git rev-parse --abbrev-ref HEAD | tr '/' '-')

# Pin CLEARML_SERVER_IMAGE to the same tag your Helm chart uses for webserver (clearml/server).
# Example: CLEARML_SERVER_IMAGE=docker.io/clearml/server:2.4.0 ./build.sh
IMAGE="${IMAGE:-europe-docker.pkg.dev/microblink-shared-services/aip/clearml/clearml-web}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found; required to build clearml-web image." >&2
  exit 1
fi

docker build . \
  -f docker/microblink-web/Dockerfile \
  --build-arg CLEARML_SERVER_IMAGE="${CLEARML_SERVER_IMAGE:-docker.io/clearml/server:2.4.0}" \
  -t "${IMAGE}:${BRANCH}"

docker push "${IMAGE}:${BRANCH}"
