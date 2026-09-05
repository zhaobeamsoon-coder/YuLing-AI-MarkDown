#!/bin/sh
set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  echo "e2e-macos: requires macOS" >&2
  exit 1
fi

repo_root=$(git rev-parse --show-toplevel)
workspace=$(mktemp -d "${TMPDIR:-/tmp}/yuling-e2e-XXXXXX")
app_pid=""
cleanup() {
  if [ -n "$app_pid" ]; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  rm -rf "$workspace"
}
trap cleanup EXIT INT TERM

cp -R "$repo_root/e2e/fixtures/rc-workspace/." "$workspace/"
touch "$workspace/.yuling-e2e-workspace"
mkdir -p "$workspace/.yulingmd"
printf '%s\n' '{"version":2,"documents":{"RC-真实样本.md":[{"anchor":"表格与公式#0","widths":[180,120,120]}]},"images":{}}' > "$workspace/.yulingmd/layout.json"

cd "$repo_root"
pnpm tauri build --features e2e --config src-tauri/tauri.e2e.conf.json --bundles app

app_bundle="$repo_root/src-tauri/target/release/bundle/macos/YuLing MD E2E.app"
app_executable="$app_bundle/Contents/MacOS/yuling-md"
if [ ! -x "$app_executable" ]; then
  echo "e2e-macos: expected executable not found: $app_executable" >&2
  exit 1
fi

YULING_E2E_WORKSPACE="$workspace" TAURI_WEBDRIVER_PORT=4445 "$app_executable" > "$workspace/app.log" 2>&1 &
app_pid=$!
attempt=0
until nc -z 127.0.0.1 4445 2>/dev/null; do
  attempt=$((attempt + 1))
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "e2e-macos: test application exited before WebDriver became ready" >&2
    sed -n '1,160p' "$workspace/app.log" >&2
    exit 1
  fi
  if [ "$attempt" -ge 200 ]; then
    echo "e2e-macos: embedded WebDriver did not become ready within 20 seconds" >&2
    exit 1
  fi
  sleep 0.1
done

YULING_E2E_WORKSPACE="$workspace" YULING_E2E_APP="$app_executable" pnpm exec wdio run e2e/wdio.conf.mjs
