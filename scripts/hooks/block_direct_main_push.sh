#!/bin/sh
set -eu

if [ "${ALLOW_DIRECT_MAIN_PUSH:-0}" = "1" ]; then
  exit 0
fi

while read -r local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/main|refs/heads/master)
      echo "Blocked direct push to ${remote_ref#refs/heads/}. Set ALLOW_DIRECT_MAIN_PUSH=1 only with explicit approval." >&2
      exit 1
      ;;
  esac
done
