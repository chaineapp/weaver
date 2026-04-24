import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { weavePaths } from "./paths.ts";
import { listPaneRecords, removePaneRecord } from "./panes.ts";
import { getProject, type ProjectRecord } from "./projects.ts";
import type { Workspace } from "./workspace.ts";

// Tearing down a project cleanly means:
//   - kill the planner tmux session (weave-<projectId>)
//   - kill every per-worktree tmux session (weave-<projectId>-<worktreeName>)
//   - drop all pane records tagged with the project from ~/.weave/panes.json
//   - remove those panes' run files from ~/.weave/runs/
//   - (optionally) git-worktree-remove each worktree
//   - delete the project folder from <workspace>/.weaver/projects/<id>/

async function killTmuxSession(name: string): Promise<void> {
  const proc = Bun.spawn(["tmux", "kill-session", "-t", name], { stdout: "pipe", stderr: "pipe" });
  await proc.exited;
  // ignore errors — if the session doesn't exist, we're already done
}

async function rmRunFile(paneId: string): Promise<void> {
  const p = weavePaths().runFile(paneId);
  try {
    await unlink(p);
  } catch {
    /* ignore */
  }
}

export type TeardownResult = {
  tmuxSessionsKilled: string[];
  panesRemoved: string[];
  worktreesRemoved: string[];
  projectFolderRemoved: boolean;
};

export async function teardownProject(
  workspace: Workspace,
  projectId: string,
  opts: { removeWorktrees?: boolean } = {},
): Promise<TeardownResult> {
  const project = await getProject(workspace, projectId);
  if (!project) {
    return {
      tmuxSessionsKilled: [],
      panesRemoved: [],
      worktreesRemoved: [],
      projectFolderRemoved: false,
    };
  }

  const tmuxSessionsKilled: string[] = [];
  const panesRemoved: string[] = [];
  const worktreesRemoved: string[] = [];

  // 1. Kill planner tmux session.
  const planner = `weave-${project.id}`;
  await killTmuxSession(planner);
  tmuxSessionsKilled.push(planner);

  // 2. Kill per-worktree tmux sessions.
  for (const wt of Object.values(project.worktrees)) {
    await killTmuxSession(wt.tmuxSession);
    tmuxSessionsKilled.push(wt.tmuxSession);
  }

  // 3. Remove panes tagged with this project.
  const panes = await listPaneRecords({ projectId: project.id });
  for (const pane of panes) {
    await rmRunFile(pane.id);
    await removePaneRecord(pane.id);
    panesRemoved.push(pane.id);
  }

  // 4. Optionally git-worktree-remove.
  if (opts.removeWorktrees) {
    for (const wt of Object.values(project.worktrees)) {
      try {
        await Bun.$`git -C ${wt.repoPath} worktree remove --force ${wt.path}`.quiet();
        worktreesRemoved.push(wt.name);
      } catch {
        /* ignore — let the user know what's left behind */
      }
    }
  }

  // 5. Delete project folder (always — it's metadata, not source code).
  const projectDir = join(workspace.weaveDir, "projects", project.id);
  await rm(projectDir, { recursive: true, force: true });

  return {
    tmuxSessionsKilled,
    panesRemoved,
    worktreesRemoved,
    projectFolderRemoved: true,
  };
}

// Nuclear option — wipe every pane record + run file + kill all weave-* tmux
// sessions. Does NOT touch project folders or workspace configs.
export async function cleanGlobal(): Promise<{
  panesRemoved: number;
  runFilesRemoved: number;
  tmuxSessionsKilled: number;
}> {
  let runFilesRemoved = 0;
  const panes = await listPaneRecords();
  for (const p of panes) {
    await rmRunFile(p.id);
    await removePaneRecord(p.id);
    runFilesRemoved++;
  }

  // Also remove any orphaned run files not in panes.json.
  try {
    const glob = new Bun.Glob("*.jsonl");
    for await (const file of glob.scan({ cwd: weavePaths().runsDir, absolute: true })) {
      try {
        await unlink(file);
        runFilesRemoved++;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  const proc = Bun.spawn(["tmux", "list-sessions", "-F", "#{session_name}"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  let tmuxSessionsKilled = 0;
  for (const line of out.split("\n")) {
    const name = line.trim();
    if (name.startsWith("weave-")) {
      await killTmuxSession(name);
      tmuxSessionsKilled++;
    }
  }

  return { panesRemoved: panes.length, runFilesRemoved, tmuxSessionsKilled };
}

// Per-project / per-worktree / per-pane panes passed back for test assertions.
export { type ProjectRecord };
