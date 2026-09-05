#!/bin/sh
set -eu

git_dir=$(git rev-parse --git-dir)
head=$(git rev-parse HEAD)
stamp="$git_dir/yuling-check-passed"

if [ ! -f "$stamp" ] || [ "$(sed -n '1p' "$stamp")" != "$head" ]; then
  echo "Run scripts/check.sh successfully for the current HEAD before pushing." >&2
  exit 1
fi
