#!/usr/bin/env bash
set -euo pipefail

version="${1:-}"
if [[ -z "$version" ]]; then
  if [[ "${GITHUB_REF_TYPE:-}" == "tag" && -n "${GITHUB_REF_NAME:-}" ]]; then
    version="$GITHUB_REF_NAME"
  else
    version="dev-$(git rev-parse --short HEAD)"
  fi
fi

commit="$(git rev-parse --short HEAD)"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ldflags="-s -w -X main.version=$version -X main.commit=$commit -X main.buildTime=$build_time"

cd cmd/know-me-desktop
case "${RUNNER_OS:-$(uname -s)}" in
  Linux)
    wails build -clean -tags webkit2_41 -ldflags "$ldflags"
    ;;
  macOS|Darwin)
    wails build -clean -platform darwin/universal -ldflags "$ldflags"
    ;;
  *)
    echo "Unsupported Unix desktop platform: ${RUNNER_OS:-$(uname -s)}" >&2
    exit 1
    ;;
esac
