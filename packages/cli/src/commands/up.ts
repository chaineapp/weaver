import { readConfig } from "@weaver/core";
import { hasSession, newSession, splitPane, listPanes, openGhostty } from "@weaver/tmux";

export async function runUp(opts: { panes: number }): Promise<void> {
  const root = process.cwd();
  const config = await readConfig(root);
  if (!config) {
    console.error("not a weaver project — run `weave init` first");
    process.exit(1);
  }

  if (!(await hasSession(config.tmuxSession))) {
    await newSession({ name: config.tmuxSession, cwd: root, command: "claude" });
    console.log(`✓ created tmux session ${config.tmuxSession} (pane 0 = claude planner)`);
  } else {
    console.log(`✓ tmux session ${config.tmuxSession} already exists, attaching`);
  }

  const existing = await listPanes(config.tmuxSession);
  const needed = opts.panes - existing.length;
  for (let i = 0; i < needed; i++) {
    const paneId = await splitPane({
      target: config.tmuxSession,
      direction: "vertical",
      cwd: root,
    });
    console.log(`  + split pane ${paneId} (idle — the planner will launch Codex in it via MCP)`);
  }

  await openGhostty({ tmuxSession: config.tmuxSession, cwd: root });
  console.log(`\n✓ Ghostty opened. Drive the planner in pane 0 (claude). It has access to the weaver MCP tools.`);
}
