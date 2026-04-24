import { findWorkspace, getProject, listProjects } from "@weaver/core";
import { hasSession, newSession, splitPane, listPanes, openGhostty } from "@weaver/tmux";

// `weave up --project <id>` starts a planner session for a project:
//   - tmux session: weave-<projectId> (separate from worktree sessions)
//   - pane 0 runs `claude` with WEAVER_WORKSPACE_ROOT + WEAVER_PROJECT_ID env
//   - Ghostty attaches to it
//
// Worker panes (codex) run in *worktree* tmux sessions named
// weave-<projectId>-<worktree>, spawned on demand by create_worktree + spawn_pane.

export async function runUp(opts: { project?: string; panes: number }): Promise<void> {
  const ws = await findWorkspace();
  if (!ws) {
    console.error("not inside a Weaver workspace — run `weave workspace init` first");
    process.exit(1);
  }

  let projectId = opts.project;
  if (!projectId) {
    // Default to the most recent project.
    const all = await listProjects(ws);
    if (all.length === 0) {
      console.error("no projects yet — `weave new` to create one");
      process.exit(1);
    }
    projectId = all[0]!.id;
    console.log(`(defaulting to most recent project: ${projectId})`);
  }

  const project = await getProject(ws, projectId);
  if (!project) {
    console.error(`no project with id ${projectId}`);
    process.exit(1);
  }

  const plannerSession = `weave-${project.id}`;

  if (!(await hasSession(plannerSession))) {
    await newSession({
      name: plannerSession,
      cwd: ws.root,
      command: "claude",
      env: {
        WEAVER_WORKSPACE_ROOT: ws.root,
        WEAVER_PROJECT_ID: project.id,
      },
    });
    console.log(`✓ started planner tmux session ${plannerSession}`);
  } else {
    console.log(`✓ planner tmux session ${plannerSession} already running`);
  }

  const existing = await listPanes(plannerSession);
  const needed = opts.panes - existing.length;
  for (let i = 0; i < needed; i++) {
    const paneId = await splitPane({ target: plannerSession, direction: "vertical", cwd: ws.root });
    console.log(`  + split pane ${paneId} (scratch — the planner drives workers via MCP)`);
  }

  await openGhostty({ tmuxSession: plannerSession });
  console.log(`\n✓ Ghostty attached. Planner is in pane 0 (claude), bound to project ${project.id}.`);
  console.log(`  MCP tools see: workspace=${ws.root}, project=${project.id}`);
}
