---
description: Dispatch N tasks to N Weaver worker panes IN PARALLEL. All workers run visibly in tmux panes; this command blocks until every worker's terminal result is captured, then returns aggregated text. Use this whenever you have 2+ independent subtasks.
argument-hint: '<json-of-{"worker-N": "task", ...}> [--binary X] [--bypass] [--cwd PATH]'
allowed-tools: Bash, Agent
---

Invoke the `weaver-dispatch-batch` subagent via the `Agent` tool, forwarding $ARGUMENTS verbatim. The subagent fans out the tasks via `weave dispatch worker-N "..." & ... & wait` and then collects results via parallel `weave tail --wait-done` calls. Each worker is visible live in its tmux pane.

Raw user input:
$ARGUMENTS

Rules:

- The first argument must be a JSON object mapping worker slot ids to task prompts. Example: `'{"worker-1": "audit packages/cli", "worker-2": "audit packages/core", "worker-3": "audit packages/tmux"}'`
- Per-worker overrides via JSON values that are objects: `{"worker-1": {"task": "...", "binary": "codex", "bypass": true}}`
- Flags `--binary`, `--bypass`, `--cwd` apply to every worker unless the JSON value overrides them.
- Subagent returns one block per worker, in `[worker-N] <result>` form. Return verbatim — do not re-format.
