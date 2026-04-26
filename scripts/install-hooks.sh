#!/usr/bin/env bash
# One-time setup: copies pre-push hook into .git/hooks/. Run once per clone.
#
#   bun run install-hooks
#
# After install, every `git push` runs `bun test && bun run eval` first. If
# you need to skip (e.g. fast doc fix, or no API budget right now):
#
#   git push --no-verify
#
# The eval consumes API tokens and takes ~40-90s. Worth the cost on dispatch /
# layout / planner-launch changes; overkill for README typos.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
HOOK="$REPO/.git/hooks/pre-push"

cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
# Auto-installed by `bun run install-hooks`. Skip with `git push --no-verify`.
set -e
echo "▶ pre-push: bun test"
bun test
echo "▶ pre-push: bun run eval"
bun run eval
EOF

chmod +x "$HOOK"
echo "✓ pre-push hook installed at $HOOK"
echo "  (skip with: git push --no-verify)"
