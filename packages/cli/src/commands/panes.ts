import { listPaneRecords, paneSummary } from "@weaver/core";

export async function runPanes(): Promise<void> {
  const root = process.cwd();
  const records = await listPaneRecords(root);
  if (records.length === 0) {
    console.log("no weaver panes in this project");
    return;
  }

  console.log(`${records.length} pane(s):\n`);
  for (const r of records) {
    const s = await paneSummary(root, r.id);
    const tokens = s.totalTokens ? ` • ${s.totalTokens} tokens` : "";
    const err = s.errorCount ? ` • ${s.errorCount} errors` : "";
    console.log(`  ${r.id.padEnd(6)} ${s.status.padEnd(10)} ${s.turns} turns${tokens}${err}`);
    console.log(`         task: ${r.task}`);
    if (s.lastMessage) console.log(`         last: ${s.lastMessage}`);
    console.log();
  }
}
