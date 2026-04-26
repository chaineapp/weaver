# Agent instructions — Weaver

Read this before writing any code in this repo.

## Repo workflow

- **Default branch is `main`. Push directly to main.** No branch protection, no PR requirement for solo work. If collaborating, open a PR but do not stack branch-off-branch.
- **Conventional Commits are required** — `feat:`, `fix:`, `refactor:`, etc. See [CONTRIBUTING.md](./CONTRIBUTING.md). The release-please workflow parses commit messages to generate CHANGELOG entries and bump versions automatically.
- Every commit message should explain the *why*, not the *what*. The diff shows what.
- No CI gate blocks merges, but do not push red. Run `bun test && bun run typecheck` locally first.
- **Run `bun run eval` before pushing changes that touch the dispatch path** — anything in `packages/cli/src/commands/{dispatch,tail,up}.ts`, `packages/tmux/src/layout.ts`, or `packages/core/src/{projects,panes,paths,init}.ts`. The eval spawns a real planner + 3 real workers in a temp tmux session and asserts the end-to-end report. ~40s, costs API tokens. Auto-picks `claude` (preferred) or `codex` (fallback); skips with a warning if neither is on PATH.
- **One-time hook setup** (recommended): `bun run install-hooks` wires `bun test && bun run eval` into git pre-push. Skip on a per-push basis with `git push --no-verify` (use sparingly — typos and docs only).
- **Never hand-edit version numbers.** release-please owns every `package.json`'s `version` field. Hand-edits will get clobbered or trigger spurious releases.

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

## Weaver philosophy (mirror of `~/.weave/USER.md`)

Weaver is for the **100x developer** — technical founders and senior engineers shipping at high velocity with small teams. When you write Weaver code, hold the same bar:

- **Bias toward shipping.** Decision speed over analysis paralysis. Default to action when the next step is reversible.
- **Force multiplier, not babysitter.** Users are sharp. Don't pad answers, don't hedge, don't ask questions whose answers you can reasonably infer.
- **Reuse over invent.** Find the existing pattern before proposing a new one.
- **Small PRs over stacked branches.** Ship one thing, merge it, ship the next.
- **Build velocity > safety theater.** When the user grants `--bypass`, trust them. Don't litter the code with disclaimers.

This block intentionally mirrors `~/.weave/USER.md`. Dogfooding case: when a Weaver planner is working on the Weaver repo itself, it gets the same brief from two angles — the user-level system prompt (USER.md, auto-injected via `--append-system-prompt`) plus this AGENTS.md (codex) / CLAUDE.md (claude, symlinked) at the repo root.

## Dispatch (when developing Weaver inside Weaver)

If you're a planner running inside `weave up` and the project under work IS the weaver repo itself, dispatch primitives are unchanged — just used on Weaver code:

- `Bash: weave panes [--project ID]` — list workers
- `Bash: weave dispatch worker-N "<task>" [--binary claude|codex] [--bypass]` — assign work
- `Bash: weave tail worker-N [--follow] [--wait-done]` — read worker output
- `Bash: bun run eval` — verify the dispatch substrate still works after a change

Don't dispatch a worker to "run the eval against my in-progress branch" naively — the eval spawns its OWN tmux session in a temp workspace, isolated from yours. Just run it directly via Bash.
