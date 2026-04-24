import { listPaneRecords, paneSummary } from "@weaver/core";

export async function runPanes(opts: { project?: string } = {}): Promise<void> {
  const records = await listPaneRecords({ projectId: opts.project });
  if (records.length === 0) {
    console.log("no weaver panes");
    return;
  }
  console.log(`${records.length} pane(s):\n`);
  for (const r of records) {
    const s = await paneSummary(r.id);
    const tokens = s.totalTokens ? ` • ${s.totalTokens} tokens` : "";
    const err = s.errorCount ? ` • ${s.errorCount} errors` : "";
    console.log(`  ${r.id.padEnd(6)} ${r.projectId}:${r.worktreeName.padEnd(30)} ${s.status.padEnd(10)} ${s.turns} turns${tokens}${err}`);
    console.log(`         task: ${r.task}`);
    if (s.lastMessage) console.log(`         last: ${s.lastMessage.slice(0, 180)}`);
    console.log();
  }
}
