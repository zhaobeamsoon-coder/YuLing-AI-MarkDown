#!/bin/sh
set -eu

version=8.30.1
destination=${1:-"$(pwd)/.yuling-local/bin"}
system=$(uname -s)
machine=$(uname -m)

case "$system/$machine" in
  Linux/x86_64) archive="gitleaks_${version}_linux_x64.tar.gz"; checksum="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb" ;;
  Darwin/arm64) archive="gitleaks_${version}_darwin_arm64.tar.gz"; checksum="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5" ;;
  *) echo "Unsupported Gitleaks platform: $system/$machine" >&2; exit 1 ;;
esac

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${version}/${archive}" -o "$temporary/$archive"
printf '%s  %s\n' "$checksum" "$temporary/$archive" | shasum -a 256 -c -
mkdir -p "$destination"
tar -xzf "$temporary/$archive" -C "$temporary" gitleaks
install -m 0755 "$temporary/gitleaks" "$destination/gitleaks"
"$destination/gitleaks" version
