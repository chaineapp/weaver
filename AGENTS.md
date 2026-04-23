# Agent instructions — Weaver

Read this before writing any code in this repo.

## Repo workflow

- **Default branch is `main`. Push directly to main.** No branch protection, no PR requirement for solo work. If collaborating, open a PR but do not stack branch-off-branch.
- Every commit message should explain the *why*, not the *what*. The diff shows what.
- No CI gate blocks merges, but do not push red. Run `bun test && bun run typecheck` locally first.

## Stack

- Bun 1.2+ for runtime, test runner, bundler. No Node fallback.
- TypeScript strict. No `any` without an inline `// @ts-expect-error` + explanation.
- Bun workspaces under `packages/*`. No Turbo, Nx, or Lerna.
- Raw SQL via `bun:sqlite` for the daemon state. No ORM.
- `@modelcontextprotocol/sdk` for the MCP server. Stdio transport only.
- `chokidar` for file watching. `execa` is not needed — use `Bun.spawn`.

## Package responsibilities

| Package | Owns |
|---|---|
| `@weaver/codex-adapter` | Codex CLI JSONL event types and parser. Pure, no side effects. |
| `@weaver/daemon` | Long-lived Bun process. Watches `.weave/runs/`, owns SQLite state, exposes Unix socket. |
| `@weaver/tmux` | Shell wrappers around `tmux` (new-session, split-window, send-keys, pipe-pane, list-panes). |
| `@weaver/mcp-orchestrator` | stdio MCP server. Talks to daemon over Unix socket. Exposes `spawn_pane`, `list_panes`, `get_pane_output`, `send_to_pane`, `kill_pane`, `pane_summary`. |
| `@weaver/cli` | User-facing `weave` command. Ink TUI for `weave panes`. |

## Coding rules

- Small modules. One exported surface per file where it makes sense.
- Never write to `.weave/` from outside the daemon. Every mutation goes through daemon API.
- Every external command invocation (`tmux`, `ghostty`, `codex`, `claude`) gets an adapter module with unit tests against fixture output.
- MCP tool return values are structured (JSON), not free text. The planner is good at parsing structure.
- Provenance on every memory file: `source_session`, `source_turn`, `updated`, `status` in frontmatter.

## Non-goals (v1)

- Embeddings, vector DBs, compression dialects. The research was unambiguous: regresses quality at this scale.
- Cross-machine / cloud deployment. Everything is local.
- Writing to Claude Code's `~/.claude/projects/` files. Read-only scan only.
- Non-macOS support. Revisit after P1 stabilizes.

## Standing instructions (always apply)

- **Plan-then-ticket**: for non-trivial work, produce a plan, check Linear, create ticket(s) if missing, then implement.
- **PR shepherd loop**: after push, wait 15–20 min, check `gh pr view --comments` + `gh run list --log-failed`, reply on every thread (resolve if fixed, leave open with reasoning if not), push fixes, loop until clean.
- **Small independent PRs** over stacked branches.

These are shipped as seed playbooks in `.weave/memory/` when `weave init` runs, so every project Weaver touches inherits them.
