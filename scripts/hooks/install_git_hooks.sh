#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
hooks_dir=$(git rev-parse --git-path hooks)
mkdir -p "$hooks_dir"

cp "$repo_root/scripts/hooks/block_direct_main_push.sh" "$hooks_dir/pre-push-main"
cp "$repo_root/scripts/hooks/require_check_passed.sh" "$hooks_dir/pre-push-check"
cp "$repo_root/scripts/hooks/scan_public_push.sh" "$hooks_dir/pre-push-privacy"

cat > "$hooks_dir/pre-push" <<'HOOK'
#!/bin/sh
set -eu
hook_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
input=$(mktemp)
trap 'rm -f "$input"' EXIT
cat > "$input"
"$hook_dir/pre-push-check"
"$hook_dir/pre-push-privacy" < "$input"
"$hook_dir/pre-push-main" < "$input"
HOOK

chmod +x "$hooks_dir/pre-push" "$hooks_dir/pre-push-main" "$hooks_dir/pre-push-check" "$hooks_dir/pre-push-privacy"
echo "Installed pre-push policy hooks."
