#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
python3 "$repo_root/tools/public_release_check.py" --pre-push --skip-remote
