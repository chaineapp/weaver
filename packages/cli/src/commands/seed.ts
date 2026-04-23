import { join } from "node:path";
import { mkdir } from "node:fs/promises";

// P1.5 — seed playbooks. These ship with every `weave init` and are available
// to the planner via the MCP memory tools (when P3 lands) and as files in the
// project. Written only if not already present, so users can edit them freely.

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

**Why:** keeps work discoverable for the team, prevents duplicate effort, makes progress legible to stakeholders.
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
   - If the feedback is actionable and fixed: reply on GitHub with what changed, mark the thread resolved.
   - If it needs more discussion: reply with reasoning, leave unresolved.
4. Fix CI failures.
5. Push. Goto 1.

**Why:** reviewers expect acknowledgement on every comment — silent resolution feels dismissive. CI catches what reviewers miss.
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

**Why:** stacked branches force reviewers to hold context across multiple PRs and make rebases painful when any middle PR changes. Independent small PRs merge as they're reviewed and keep the graph linear.

**When stacking is OK:** the second branch genuinely depends on unmerged code in the first AND the first is ready to merge within hours, not days.
`,
  },
  {
    path: "INDEX.md",
    content: `# Memory index

Seed playbooks auto-written by \`weave init\`. Extend freely — add your own architectural decisions, service docs, runbooks. The planner Claude can read these via the MCP memory tools (P3 of the Weaver plan).

## Patterns
- [plan-then-ticket](patterns/plan-then-ticket.md) — plan first, check/create Linear tickets, then code
- [small-independent-prs](patterns/small-independent-prs.md) — prefer small PRs targeting main over stacked branches

## Runbooks
- [pr-shepherd-loop](runbooks/pr-shepherd-loop.md) — after push, wait 15-20min, check comments + CI, reply on every thread, push fixes, loop
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
    if (await file.exists()) continue; // never overwrite user edits
    await Bun.write(full, seed.content);
  }
}
