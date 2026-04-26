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

## Architecture: TypeScript surface, portable hot-path

**Default**: Weaver is TypeScript on Bun, and the user-facing surface (CLI, SDK, MCP server) stays TS forever. Iteration speed and audience alignment with the AI-SDK ecosystem outweigh raw perf for everything Weaver does today, and Weaver itself isn't on the hot path — agents and Ghostty are.

**Forward-compatibility rule**: structure packages so that *if* a real bottleneck demands a Rust (or Go, or Zig) port later, it's a contained project, not a rewrite. Keep boundaries language-neutral by construction. Don't pay the cost now; preserve the option.

| Package | Stays TS forever | Could port to Rust if needed |
|---|---|---|
| `@weaver/cli` | ✅ ergonomics live here | |
| `@weaver/sdk` (future) | ✅ devs install via npm | |
| `@weaver/mcp-orchestrator` | ✅ MCP TS SDK is canonical | |
| `@weaver/core` | ✅ shared types, mostly | |
| `@weaver/codex-adapter` | ✅ pure parser | |
| `@weaver/tmux` | ✅ thin shell-out layer | |
| `@weaver/daemon` (CHA-985, not built) | | ✅ if >5k events/sec sustained |
| Live TUI dashboard (CHA-986) | | ✅ if 60fps and Ink can't keep up |
| Future scrollback indexer | | ✅ if it ever exists |

### Rules to keep the option open

1. **No direct TypeScript imports across boundaries that might become process boundaries.** `@weaver/cli` may import types from `@weaver/core` (both stay TS). It must NOT import from `@weaver/daemon` — talk over a Unix socket / JSON-RPC. The boundary is the wire format, not a TS module.
2. **Contracts are language-neutral.** When data crosses a portable boundary, define the wire shape (JSON Schema, or a TS type used *only* to validate at the edge) and serialize. The implementation could be Rust tomorrow.
3. **Files and stdio are first-class wire formats.** Run files (JSONL), pane registry (JSON), MCP stdio protocol — all language-neutral. Don't replace them with shared in-process state.
4. **No "just import the daemon function directly when running locally" shortcuts.** Tempting and a one-way door. The moment that ships, the daemon can never be its own process.

### Three signals that *would* mean port a hot-path package

Don't port on instinct. Port when one of these fires (and document the measurement in the PR):

1. The daemon sustains >5k events/sec and Bun's GC shows in flame graphs.
2. A live dashboard demands 60fps and Ink can't keep up after honest optimization.
3. A hosted multi-tenant deployment exists and per-tenant overhead is the bottleneck.

When that happens, port one package. CLI / SDK / MCP server don't change. Users don't notice.

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
