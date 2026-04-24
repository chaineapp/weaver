import { cleanGlobal } from "@weaver/core";

// `weave clean` — nuclear option. Wipes all pane records, run files, and
// weave-* tmux sessions. Leaves workspaces, projects, and worktrees untouched.

export async function runClean(): Promise<void> {
  const r = await cleanGlobal();
  console.log(`✓ cleaned Weaver state`);
  console.log(`  panes removed:        ${r.panesRemoved}`);
  console.log(`  run files removed:    ${r.runFilesRemoved}`);
  console.log(`  tmux sessions killed: ${r.tmuxSessionsKilled}`);
}
