#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

python3 tools/public_release_check.py
