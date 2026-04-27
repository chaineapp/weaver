---
description: Dispatch ONE task to a Weaver worker pane (codex or claude). Worker runs visibly in the user's tmux pane; this slash command blocks until the worker emits its terminal result and returns the final text.
argument-hint: "<worker-N> <task...> [--binary codex|claude] [--bypass] [--model M] [--cwd PATH]"
allowed-tools: Bash, Agent
---

Invoke the `weaver-dispatch` subagent via the `Agent` tool, forwarding $ARGUMENTS verbatim. The subagent runs `weave dispatch` + `weave tail --wait-done` against the user's existing weave session, so the worker is visible live in the corresponding tmux pane.

This is the one-worker form. For 2-N parallel workers, prefer `/weaver:dispatch-batch`.

Raw user input:
$ARGUMENTS

Rules:

- The first positional argument must be a worker slot id (`worker-1`, `worker-2`, ...) — call `weave panes` first if you don't know which slots exist.
- Everything after the worker id is the task prompt, until the first `--` flag.
- Pass `--binary codex` + `--bypass` for codex with permissions; `--binary claude` for a fresh claude (defaults to whatever the worker pane was registered with at `weave up` time, typically codex).
- Default cwd is the project repo. Override with `--cwd <path>` when working in a separate worktree.
- Return the subagent's output verbatim. Do not summarize, paraphrase, or wrap in markdown — the subagent already returns clean text.
