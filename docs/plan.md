# Weaver — Coding Agent Orchestrator + Memory

## Context

Current pain: the user's daily workflow is one Claude session for planning + 1–3 Codex CLI sessions for execution. Today that loop runs on manual copy-paste between terminals — Claude writes prompts, user pastes into Codex, Codex replies, user pastes back. Slow, lossy, no state.

"Persona" is the long-term vision (mobile/web, cloud brain, Linear integration, compaction IP). **This plan is the MVP shim that buys time until Persona.** Scope: local Bun CLI, new standalone public repo, push-to-main, open source. One target user, one machine, macOS + Ghostty.

**Success = the user can open one terminal, say "plan this task," and have the planning session spawn and monitor 1–6 Codex workers without any copy-paste.** Everything else (memory, desktop session mirror) is staged behind that.

## Name

**Weaver** (CLI command: `weave`). Package: `@weaver/cli`. Repo: `github.com/<org>/weaver` (new, public, push-to-main).

## Phased delivery — explicit priority (user-stated)

| Phase | Ships | Why this order |
|---|---|---|
| **P1 — Orchestration** | `weave` CLI, tmux-in-Ghostty panes, Codex workers, MCP server exposing pane state to planner Claude | Removes copy-paste today |
| **P2 — Auto-memory extract** | `Stop`-hook sibling writes architectural decisions to `.weave/memory/sessions/` | Captures the expensive tacit knowledge from P1 sessions |
| **P3 — Memory MCP + folder structure** | 7-folder `.memory/` tree, 5 MCP tools, `/remember` slash command, weekly promotion | Makes P2 extracts retrievable |
| **P4 — Claude desktop session mirror** | Scan `~/.claude/projects/*.jsonl`, expose as list, allow spawn-from-Weaver | Nice-to-have, defer until P1–P3 stable |

Only P1 is fully specified below. P2–P4 are sketches; each gets its own plan when we reach it.

---

## P1 — Orchestration (fully specified)

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Ghostty window (one per project)                   │
│  ┌───────────────────────────────────────────────┐  │
│  │  tmux session: weave-<project>                │  │
│  │  ┌─────────────┬─────────────┬─────────────┐  │  │
│  │  │ pane 0      │ pane 1      │ pane 2      │  │  │
│  │  │ PLANNER     │ WORKER      │ WORKER      │  │  │
│  │  │ claude TUI  │ codex exec  │ codex exec  │  │  │
│  │  │             │ --json      │ --json      │  │  │
│  │  └─────────────┴─────────────┴─────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
         │                    │              │
         │ MCP (stdio)        │ pipe-pane    │ pipe-pane
         ▼                    ▼              ▼
   Weaver daemon  ←─── .weave/runs/<pane>.jsonl (tailed)
   (Bun, SQLite WAL)
```

**Key choices (from research, see §Sources):**

- **tmux inside Ghostty**, not raw Ghostty AppleScript. tmux gives (a) `pipe-pane` to tee every pane's stdout to a file for free, (b) `send-keys` for deterministic input injection, (c) attach/detach (survives Ghostty restart), (d) devs already know it. Ghostty is the pretty shell around it; tmux is the programmable substrate. User's "AI-native + dev-friendly" criterion matches this exactly.
- **Codex workers in `codex exec --json` mode.** JSONL stream of `turn.*` / `item.*` events. Resumable via `codex exec resume <session-id>`.
- **Weaver daemon** (Bun, long-lived) watches `.weave/runs/<pane>.jsonl` via `chokidar`, persists pane state to `.weave/state.db` (SQLite WAL).
- **MCP server over stdio**, registered in the planner's Claude Code config (`~/.claude/mcp.json` or project `.mcp.json`). Planner Claude calls MCP tools like any other tool — zero code changes to Claude Code itself.

### MCP tool surface (planner → orchestrator)

| Tool | Purpose |
|---|---|
| `spawn_pane(task, model?)` | Create new Codex worker pane, return `pane_id`. Idempotent by `task` hash. |
| `list_panes()` | All panes in current project: id, status, last event timestamp, one-line summary. |
| `get_pane_output(pane_id, since?)` | Return JSONL events since offset (or full tail). Structured, not raw text. |
| `send_to_pane(pane_id, text)` | Inject stdin via `tmux send-keys`. |
| `kill_pane(pane_id)` | Stop worker cleanly. |
| `pane_summary(pane_id)` | Cheap summary: "working on X, last file changed Y, 3 errors." Computed from JSONL, no extra LLM call. |

Non-goals for P1: no `get_context`, no search, no memory tools (those are P3).

### CLI surface (user-facing)

```
weave init                    # in a project dir: set up .weave/, tmux session, planner pane
weave up [--panes N]          # (re)open Ghostty+tmux layout for this project
weave panes                   # ls panes, status, tokens
weave attach <pane_id>        # tmux attach into that pane for manual driving
weave kill <pane_id>
weave doctor                  # verify tmux, Ghostty, codex, claude CLIs present
```

`weave init` also writes `.mcp.json` in the project so the planner Claude picks up Weaver's MCP server automatically.

### File layout (inside Weaver repo)

```
weaver/
├── packages/
│   ├── cli/                  # `weave` command, TUI entry
│   │   ├── src/commands/     # init, up, panes, attach, kill, doctor
│   │   └── src/tui/          # Ink-based pane-list view
│   ├── daemon/               # long-lived Bun process; watches runs/, owns SQLite
│   │   ├── src/watcher.ts    # chokidar tail → event parser
│   │   ├── src/state.ts      # SQLite ORM (minimal, raw SQL)
│   │   └── src/tmux.ts       # spawn/kill panes via `tmux` shell calls
│   ├── mcp-orchestrator/     # stdio MCP server using @modelcontextprotocol/sdk
│   │   └── src/tools/        # spawn_pane, list_panes, get_pane_output, ...
│   └── codex-adapter/        # JSONL event types + parser (from `codex exec --json`)
├── docs/                     # contributor docs, ADRs for Weaver itself
├── AGENTS.md                 # coding rules for agents working on Weaver
└── README.md
```

Bun workspaces. No Turbo/Nx — keep it boring.

### Per-project runtime layout

```
<project>/
├── .mcp.json                 # points at weaver MCP server (auto-written by `weave init`)
├── .weave/
│   ├── state.db              # SQLite WAL, owned by daemon
│   ├── runs/                 # one JSONL per pane, tee'd via tmux pipe-pane
│   │   └── <pane_id>.jsonl
│   └── config.json           # pane count, model choices, project name
```

### Implementation order (P1 subtasks)

1. **`codex-adapter`** — event types + parser, unit-tested against fixture JSONL. No runtime dependency yet.
2. **`daemon` skeleton** — chokidar watcher, SQLite schema (`panes`, `events`), in-memory projection.
3. **`tmux.ts`** — `createSession`, `splitPane`, `sendKeys`, `pipePane`, `listPanes`. Shell out via `Bun.spawn`.
4. **`cli init` + `cli up`** — bootstrap `.weave/`, open Ghostty (via `open -a Ghostty`), spawn tmux session, spawn planner pane with `claude`, expose MCP config.
5. **`mcp-orchestrator`** — stdio server, 6 tools above. Calls daemon over local Unix socket (`~/.weave/daemon.sock`).
6. **`cli panes` TUI** — Ink list view, refreshes on daemon events.
7. **`doctor`** — version check for `tmux`, `codex`, `claude`, Ghostty present, AppleScript permissions.
8. **End-to-end dogfood** — use Weaver to build Weaver. When `weave up --panes 3` spawns 3 Codex workers against Weaver's own issues and the planner can read their output via MCP, P1 is done.

### Repo/infra setup

- New GitHub repo, public, MIT license.
- Default branch `main`. Branch protection OFF (user wants push-to-main).
- CI: single GitHub Actions workflow — `bun install && bun test && bun run typecheck`.
- `AGENTS.md` in Weaver repo mirrors chain5 style but adapted: Bun runtime, push-to-main, small-PR preference still applies.
- **No changes to chain5's `AGENTS.md`** — Weaver lives in its own repo, separate concern.
- Release: none for v0.x. Just `git clone && bun install && bun link`.

### Verification (how we know P1 works)

1. `weave doctor` passes.
2. `cd ~/Code/chain5 && weave init && weave up --panes 3` opens one Ghostty window with a tmux session, 1 planner pane running `claude`, 2 worker panes idle.
3. In planner Claude, prompt: "use the weaver MCP tools to spawn a codex worker that summarizes README.md and show me its output." Planner calls `spawn_pane` → `get_pane_output` → reports summary back without user copy-paste. **This is the acceptance test.**
4. `weave panes` (separate shell) shows 2 active panes with last-event timestamps.
5. Kill Ghostty; run `weave up` again — panes reattach to tmux session intact (state.db preserved).
6. Run 6 panes; confirm daemon memory stays under 100 MB.

---

## P1.5 — Seed playbooks (ships with P1, pre-populated)

**Problem:** The user re-types the same standing instructions into every new agent session — plan-then-ticket, and push-then-shepherd-PR-comments. Waiting for auto-extraction (P2) to surface these would mean re-typing them for weeks. They're well-known up-front, so seed them.

**Shape:** `weave init` writes the following **canonical** memory files into `.weave/memory/` from day one (P1 ships the folder scaffold even though P3 builds the full system). Also exposed as **MCP prompts** so the planner Claude can invoke them by name.

### Seed 1 — `patterns/plan-then-ticket.md`

> Before writing code for a non-trivial task:
> 1. Produce a plan (requirements outline, approach, risks).
> 2. Review existing Linear tickets — search by keyword, check the current cycle, check the relevant project. Link findings.
> 3. If no ticket covers the work: create it. For a big feature, create a Linear **project** with pod + milestones and child issues; for a small change, one issue is fine.
> 4. Only then begin implementation. Every PR links the ticket.
>
> **Why:** keeps work discoverable for the team, prevents duplicate effort, makes progress legible to stakeholders.

Exposed as MCP prompt `plan_and_ticket` → planner Claude can run `/plan_and_ticket <task>` and get this procedure bound into context.

### Seed 2 — `runbooks/pr-shepherd-loop.md`

> After pushing a branch and opening a PR:
> 1. Wait 15–20 minutes for reviewers + CI.
> 2. Check PR comments (`gh pr view --comments`) and CI (`gh run list --log-failed`).
> 3. For each review comment:
>    - If the feedback is actionable and you fix it: reply on GitHub with what changed, mark resolved.
>    - If it needs more discussion: reply with your reasoning, leave unresolved.
> 4. Push fixes. Goto 1. Minimum 5 iterations or until the thread is clean.
>
> **Why:** reviewers expect acknowledgement on every comment; silent resolution feels dismissive. CI catches what reviewers miss.

Exposed as MCP prompt `shepherd_pr` → optionally with an auto-loop mode that runs the cycle on a timer from the Weaver daemon.

### Why seed vs auto-extract

- These are **stable instructions**, not emergent knowledge. Auto-extract is for the expensive tacit stuff (why we chose event sourcing, what breaks in the mobile tracking pipeline). Seed is for the checklists you'd otherwise put in every system prompt.
- Ships as part of `weave init` templates — user can edit/override per-project. Version-controlled with the repo.
- MCP prompt exposure means the planner doesn't need to "remember" these; it calls them by name.

**Other seed candidates to ship from the user's existing auto-memory** (`~/.claude/projects/.../memory/MEMORY.md`):
- Package naming convention (`@chain` not `@chaine`) → seed as `glossary/package-naming.md` when working in chain repos.
- PR comment handling rules → already covered by `runbooks/pr-shepherd-loop.md`.
- Agent CI monitoring loop → merge into `runbooks/pr-shepherd-loop.md`.
- PR strategy (small independent PRs over stacked) → `patterns/pr-small-and-independent.md`.

Seed files carry `status: canonical` and `source: seed` in frontmatter so P2's extractor doesn't overwrite them.

---

## P2 — Auto-memory extract (sketch only)

- Claude Code `Stop` hook posts transcript + git diff to Weaver daemon.
- Daemon runs a small extractor subagent (Haiku) with a tight prompt: "emit 0–3 architectural decisions / service contracts / test patterns / gotchas as markdown with frontmatter."
- Writes to `.weave/memory/sessions/<ts>-<slug>.md` with `status: draft`, `source_session: <claude-session-id>`, `source_turn: <uuid>`. Provenance is mandatory (Soni's warning).
- No retrieval yet — just capture.

## P3 — Memory MCP + folder structure (sketch only)

Seven folders (from research, §Sources):

```
.weave/memory/
├── INDEX.md                 # auto-rebuilt from frontmatter
├── decisions/               # YYYY-MM-DD-claim-slug.md, ADR-style
├── services/                # one file per service, I/O contracts
├── patterns/                # testing + idioms, timeless, title = claim
├── glossary/                # jedi, symphony, CHA-950, etc.
├── product/                 # AI-native feature docs
├── runbooks/                # debug playbooks, mirrors chain5 docs/debug-playbooks/
└── sessions/                # P2 drafts land here, promoted weekly
```

Five MCP tools: `list_memories`, `read_memory`, `search_memories` (ripgrep, no embeddings v1), `recent_memories`, `get_context` (optional convenience wrapper).

`/remember <claim>` slash command for explicit canonical writes. Weekly `/consolidate` promotion pass (sub-agent dedupes sessions/ into canonical folders).

**Explicitly deferred**: embeddings, AAAK-style compression, vector DB. Research showed both regress quality on realistic coding workloads and Opus 4.7 1M-context handles the token-cost problem natively.

## P4 — Claude desktop session mirror (sketch only)

Read-only scan of `~/.claude/projects/<encoded-cwd>/*.jsonl` → title from first user message → expose as `weave sessions`. Writing new sessions visible to desktop requires matching Claude Code's file format exactly; defer until need is proven.

---

## Locked decisions

- **Repo**: `github.com/chaineapp/weaver` (new, push-to-main, no branch protection)
- **License**: MIT (default for open source; revisit if we need to)
- **Runtime**: Bun 1.2+, Bun-only (no Node fallback in v1)

## Sources

- Orchestration research agent: `sunny-mixing-diffie-agent-a1216e4151d1d7a25` (plan-agent session)
- Memory research agent: `/Users/pom/.claude/plans/sunny-mixing-diffie-agent-ae9deee466c3e2b4b.md`
- [sst/opencode](https://github.com/sst/opencode) — client/server split
- [garrytan/gbrain](https://github.com/garrytan/gbrain) — markdown-in-Git memory, reference impl
- [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code) — Claude Code reimpl, harness reference
- [anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript) — planner integration
- [Ghostty AppleScript docs](https://ghostty.org/docs/features/applescript) — fallback if tmux becomes painful
- [Codex non-interactive](https://developers.openai.com/codex/noninteractive) — `codex exec --json`
- [Anthropic — Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — validates file-based memory
- [MemPalace issue #27](https://github.com/milla-jovovich/mempalace/issues/27) — why we're not copying them
- [Nishant Soni — thousand OpenClaw deploys](https://blog.nishantsoni.com/p/ive-seen-a-thousand-openclaw-deploys) — strategic forgetting problem
