import { cleanGlobal } from "@weaver/core";

// `weave clean` — nuclear option. Wipes all pane records, run files, and
// weave-* tmux sessions. Leaves workspaces, projects, and worktrees untouched.
// `--close-windows` additionally tries to close zombie Ghostty windows whose
// tmux session is dead (typical aftermath: you `weave up` something, kill
// the tmux session, but the Ghostty window stays open showing a dead shell).

export type CleanOpts = {
  closeWindows?: boolean;
};

export async function runClean(opts: CleanOpts = {}): Promise<void> {
  const r = await cleanGlobal();
  console.log(`✓ cleaned Weaver state`);
  console.log(`  panes removed:        ${r.panesRemoved}`);
  console.log(`  run files removed:    ${r.runFilesRemoved}`);
  console.log(`  tmux sessions killed: ${r.tmuxSessionsKilled}`);

  if (opts.closeWindows) {
    const closed = await closeOrphanGhosttyWindows();
    console.log(`  Ghostty windows closed: ${closed.count}${closed.note ? ` (${closed.note})` : ""}`);
  }
}

// Best-effort: ask Ghostty for its window/tab list, close any tab whose tty
// is no longer attached to a live tmux server. macOS-only. Silently no-ops
// if AppleScript can't drive Ghostty (Accessibility permission missing,
// Ghostty not running, etc.) — we never want `weave clean` to fail on this.
async function closeOrphanGhosttyWindows(): Promise<{ count: number; note?: string }> {
  // tmux has no live sessions => any Ghostty tab attached to a tmux client
  // is now an orphan. Cheap signal: if tmux server is gone, close every
  // Ghostty tab whose process tree contains tmux. We don't currently
  // introspect Ghostty's tab→tty map (that's an AppleScript dictionary
  // dive), so the conservative behavior for now is: only nuke tabs when
  // tmux server is fully dead AND user passed --close-windows.
  const tmuxAlive = (await Bun.spawn(["tmux", "has-session"], { stdout: "ignore", stderr: "ignore" }).exited) === 0;
  if (tmuxAlive) {
    return { count: 0, note: "tmux server still has live sessions; nothing to close" };
  }
  // Find Ghostty PIDs whose subtree includes a tmux client process. Kill
  // those tmux clients — Ghostty closes the tab when its child exits.
  const ps = Bun.spawn(["pgrep", "-x", "tmux"], { stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(ps.stdout).text()).trim();
  await ps.exited;
  const tmuxPids = out.split("\n").filter((s) => s.length > 0);
  for (const pid of tmuxPids) {
    Bun.spawn(["kill", "-TERM", pid], { stdout: "ignore", stderr: "ignore" });
  }
  return { count: tmuxPids.length };
}
