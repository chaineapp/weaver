import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const SEEDS: Array<{ path: string; content: string }> = [
  {
    path: "patterns/plan-then-ticket.md",
    content: `---
name: Plan-then-ticket before coding
status: canonical
source: seed
tags: [workflow, linear]
---

Before writing code for a non-trivial task:

1. Produce a plan — requirements outline, approach, risks. Get user sign-off.
2. Review existing Linear tickets. Search by keyword, check the current cycle, check the relevant project. Link findings.
3. If no ticket covers the work, create it:
   - Big feature → Linear **project** with pod + milestones and child issues.
   - Small change → one issue.
4. Only then begin implementation. Every PR links the ticket.

**Why:** keeps work discoverable, prevents duplicate effort, makes progress legible to stakeholders.
`,
  },
  {
    path: "runbooks/pr-shepherd-loop.md",
    content: `---
name: PR shepherd loop after push
status: canonical
source: seed
tags: [workflow, pr, ci]
---

After pushing a branch and opening a PR, run this loop (minimum 5 iterations or until the PR is clean):

1. Wait 15–20 minutes for reviewers + CI.
2. Check PR comments: \`gh pr view --comments\`. Check CI: \`gh run list --log-failed\`.
3. For every review comment:
   - If actionable and fixed: reply on GitHub with what changed, mark the thread resolved.
   - If it needs more discussion: reply with reasoning, leave unresolved.
4. Fix CI failures.
5. Push. Goto 1.

**Why:** reviewers expect acknowledgement — silent resolution feels dismissive. CI catches what reviewers miss.
`,
  },
  {
    path: "patterns/small-independent-prs.md",
    content: `---
name: Small independent PRs over stacked branches
status: canonical
source: seed
tags: [workflow, pr, branching]
---

Prefer PRs that target \`main\` directly and land independently. Avoid feature-branch-off-feature-branch stacking.

**Why:** stacked branches force reviewers to hold context across multiple PRs and make rebases painful.

**When stacking is OK:** the second branch genuinely depends on unmerged code in the first AND the first is ready to merge within hours.
`,
  },
  {
    path: "patterns/parallel-dispatch.md",
    content: `---
name: Parallel dispatch with auto-loop
status: canonical
source: seed
tags: [workflow, codex, mcp, orchestration]
---

When a task breaks into 2+ independent sub-tasks, don't do them serially. Use Weaver's MCP tools to run them in parallel and auto-collect results.

**Playbook (you, the planner Claude):**

1. Break the task into sub-tasks. Before spawning, state the breakdown and the proposed parallelism count to the user and ask if they want to adjust.
2. For each sub-task, call \`spawn_pane({ task: "<precise one-line prompt>" })\`. Codex runs in a tmux pane; output streams to \`~/.weave/runs/<pane>.jsonl\`.
3. Enter the auto-loop:
   - Call \`wait_for_updates({ timeout_seconds: 30 })\`.
   - For each pane in the result, call \`get_pane_output({ pane_id })\` (auto-advances the review cursor).
   - Digest the new events. If a pane hit \`turn.completed\` or \`turn.failed\`, summarize back to the user.
   - If you need clarification from the user before continuing, stop and ask. Don't speculate.
   - Otherwise, go back to \`wait_for_updates\`. Repeat until all panes are terminal.
4. Keep the user informed proactively — after each completed pane, a one-paragraph summary of what changed and what's next. Don't wait for them to ask.
5. If a pane fails or gets stuck, either \`send_to_pane\` to unstick it, \`kill_pane\` and re-\`spawn_pane\` with a revised prompt, or bring the question to the user.

**Do not** re-spawn the same task in parallel (idempotency is task-driven). **Do not** poll every tool call — use \`wait_for_updates\` so you only wake when something happened.

**Why:** the user's time is the bottleneck. Weaver is specifically built to remove the copy-paste loop. Act like N Codex workers are silently running in the background — because they are.
`,
  },
  {
    path: "INDEX.md",
    content: `# Memory index

Seed playbooks written by \`weave init\`. Extend freely.

## Patterns
- [plan-then-ticket](patterns/plan-then-ticket.md)
- [parallel-dispatch](patterns/parallel-dispatch.md) — THE auto-loop playbook. Read first.
- [small-independent-prs](patterns/small-independent-prs.md)

## Runbooks
- [pr-shepherd-loop](runbooks/pr-shepherd-loop.md)
`,
  },
];

export async function writeSeedPlaybooks(memoryDir: string): Promise<void> {
  await mkdir(memoryDir, { recursive: true });
  for (const seed of SEEDS) {
    const full = join(memoryDir, seed.path);
    const dir = full.substring(0, full.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    const file = Bun.file(full);
    if (await file.exists()) continue;
    await Bun.write(full, seed.content);
  }
}
