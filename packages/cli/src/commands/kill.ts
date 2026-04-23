import { removePaneRecord } from "@weaver/core";
import { killPane } from "@weaver/tmux";

export async function runKill(opts: { paneId: string }): Promise<void> {
  await killPane(opts.paneId);
  await removePaneRecord(process.cwd(), opts.paneId);
  console.log(`✓ killed pane ${opts.paneId}`);
}
