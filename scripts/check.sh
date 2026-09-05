#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

python3 tools/repository_boundary_check.py
python3 scripts/test_policies.py
python3 scripts/test_e2e_boundary.py

if [ -f package.json ]; then
  pnpm lint
  pnpm test
  pnpm build
fi

if [ -f src-tauri/Cargo.toml ]; then
  cargo test --manifest-path src-tauri/Cargo.toml
  cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
fi

if [ -f pyproject.toml ]; then
  python3 -m pytest
fi

scripts/license_check.sh
git rev-parse HEAD > "$(git rev-parse --git-dir)/yuling-check-passed"
echo "full check: passed"
