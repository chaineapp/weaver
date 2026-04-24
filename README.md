# Weaver

Coding agent orchestrator. A Bun CLI that spawns Codex CLI workers in tmux panes inside Ghostty and exposes them to a planner Claude session via MCP — so the planner can see, drive, and aggregate N sub-agents without copy-paste.

**Status:** pre-alpha (v0.3.x). See [`docs/plan.md`](./docs/plan.md) for the phased roadmap, [`CHANGELOG.md`](./CHANGELOG.md) for release history, and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the conventional-commits workflow.

[![CI](https://github.com/chaineapp/weaver/actions/workflows/ci.yml/badge.svg)](https://github.com/chaineapp/weaver/actions/workflows/ci.yml)
[![Release](https://github.com/chaineapp/weaver/actions/workflows/release.yml/badge.svg)](https://github.com/chaineapp/weaver/actions/workflows/release.yml)

## Why

Today's multi-agent workflow is: one Claude session plans, N Codex sessions execute, and you manually shuttle text between them. Weaver closes the loop — the planner gets MCP tools to spawn panes, stream their output, and send input back.

## Requirements

- macOS (for Ghostty AppleScript integration)
- [Bun](https://bun.sh) 1.2+
- [Ghostty](https://ghostty.org/) 1.3+
- `tmux` (`brew install tmux`)
- [OpenAI Codex CLI](https://developers.openai.com/codex/)
- [Claude Code](https://claude.com/claude-code)

Run `weave doctor` to verify.

## Quick start

```bash
git clone https://github.com/chaineapp/weaver.git
cd weaver
bun install
bun link

cd ~/your-project
weave init
weave up --panes 3
```

## Architecture

See [`docs/plan.md`](./docs/plan.md).

## License

MIT
