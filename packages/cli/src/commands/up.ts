import { readConfig, resolveOrRegister } from "@weaver/core";
import { hasSession, newSession, splitPane, listPanes, openGhostty } from "@weaver/tmux";
import { resolve } from "node:path";

export async function runUp(opts: { panes: number; path?: string }): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) {
    console.error("Weaver not initialized yet — run `weave init` once.");
    process.exit(1);
  }

  const path = resolve(opts.path ?? process.cwd());
  const { project, worktree, created } = await resolveOrRegister(path);
  if (created) {
    console.log(`✓ registered ${project.id}${worktree.id === "main" ? "" : `:${worktree.id}`} (${worktree.path})`);
  }

  if (!(await hasSession(worktree.tmuxSession))) {
    await newSession({ name: worktree.tmuxSession, cwd: worktree.path, command: "claude" });
    console.log(`✓ created tmux session ${worktree.tmuxSession} (pane 0 = claude planner)`);
  } else {
    console.log(`✓ tmux session ${worktree.tmuxSession} already exists`);
  }

  const existing = await listPanes(worktree.tmuxSession);
  const needed = opts.panes - existing.length;
  for (let i = 0; i < needed; i++) {
    const paneId = await splitPane({
      target: worktree.tmuxSession,
      direction: "vertical",
      cwd: worktree.path,
    });
    console.log(`  + split pane ${paneId} (idle — the planner launches Codex in it via MCP)`);
  }

  await openGhostty({ tmuxSession: worktree.tmuxSession, cwd: worktree.path });
  console.log(
    `\n✓ Ghostty opened for ${project.id}${worktree.id === "main" ? "" : `:${worktree.id}`}. Drive the planner in pane 0.`,
  );
}
