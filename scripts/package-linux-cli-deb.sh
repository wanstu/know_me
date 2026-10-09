#!/usr/bin/env bash
set -euo pipefail

# Package an already-built, pure-Go Linux CLI with Kit's opt-in systemd
# lifecycle. Do not package the Wails desktop app as the server service.
if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <built-linux-amd64-binary> <release-tag> <output-dir>" >&2
  exit 2
fi

binary="$1"
tag="$2"
dist="$3"

if [[ ! -f "$binary" ]]; then
  echo "CLI binary does not exist: $binary" >&2
  exit 2
fi
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]]; then
  echo "Expected vX.Y.Z or vX.Y.Z-rc.N, got: $tag" >&2
  exit 2
fi

# In Debian versions a tilde sorts RC builds before the stable version.
deb_version="${tag#v}"
deb_version="${deb_version/-rc./~rc.}"

go run github.com/wanstu/wails-desktop-kit/cmd/desktopkit package linux \
  --input "$binary" \
  --dist "$dist" \
  --app-name know-me \
  --asset-base "know-me-$tag" \
  --package-name know-me-cli \
  --package-version "$deb_version" \
  --arch amd64 \
  --formats deb \
  --description "Know Me headless HTTP server with systemd" \
  --maintainer "wanstu" \
  --section web \
  --systemd \
  --service-name know-me-cli \
  --service-description "Know Me HTTP server" \
  --service-user know-me-cli \
  --service-group know-me-cli \
  --service-data-dir /var/lib/know-me-cli \
  --service-arg=serve \
  --service-arg=--data-dir \
  --service-arg=/var/lib/know-me-cli/data \
  --service-arg=--uploads-dir \
  --service-arg=/var/lib/know-me-cli/uploads

package="$dist/know-me-$tag-linux-amd64.deb"
test -s "$package"
test -s "$package.sha256"
echo "CLI Debian service package: $package"
