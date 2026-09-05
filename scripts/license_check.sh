#!/bin/sh
set -eu

if [ -f pnpm-lock.yaml ]; then
  pnpm licenses list --json > /tmp/yuling-license-report.json
  if rg -i 'SSPL|Commons Clause|Business Source License|BUSL' /tmp/yuling-license-report.json >/dev/null; then
    echo "Blocked dependency license detected." >&2
    exit 1
  fi
fi
echo "license policy: ok"
