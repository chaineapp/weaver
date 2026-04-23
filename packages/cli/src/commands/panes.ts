import { listPaneRecords, paneSummary } from "@weaver/core";

export async function runPanes(opts: { project?: string; worktree?: string } = {}): Promise<void> {
  const records = await listPaneRecords({ projectId: opts.project, worktreeId: opts.worktree });
  if (records.length === 0) {
    console.log("no weaver panes");
    return;
  }

  console.log(`${records.length} pane(s):\n`);
  for (const r of records) {
    const s = await paneSummary(r.id);
    const tokens = s.totalTokens ? ` • ${s.totalTokens} tokens` : "";
    const err = s.errorCount ? ` • ${s.errorCount} errors` : "";
    const scope = `${r.projectId}${r.worktreeId === "main" ? "" : `:${r.worktreeId}`}`;
    console.log(`  ${r.id.padEnd(6)} ${scope.padEnd(24)} ${s.status.padEnd(10)} ${s.turns} turns${tokens}${err}`);
    console.log(`         task: ${r.task}`);
    if (s.lastMessage) console.log(`         last: ${s.lastMessage}`);
    console.log();
  }
}
