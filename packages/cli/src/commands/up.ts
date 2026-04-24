import { findWorkspace, getProject, listProjects } from "@weaver/core";
import { hasSession, newSession, listPanes, openGhostty, buildPlannerLayout, selectPane, setStatusLeft } from "@weaver/tmux";

// `weave up --project <id> --panes <workers>`:
//   - creates tmux session weave-<id> if missing, pane 0 runs `claude`
//   - builds a planner-left + workers-grid-right layout on first creation
//   - opens Ghostty attached to the session
//
// --panes N = number of WORKER panes on the right (1..6). The planner is
// always in addition. So --panes 4 gives you: 1 planner + 2x2 workers.

export async function runUp(opts: { project?: string; panes: number }): Promise<void> {
  const ws = await findWorkspace();
  if (!ws) {
    console.error("not inside a Weaver workspace — run `weave workspace init` first");
    process.exit(1);
  }

  let projectId = opts.project;
  if (!projectId) {
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
  const isFresh = !(await hasSession(plannerSession));

  // Run the planner from the project folder so Claude Code picks up the
  // CLAUDE.md that createProject wrote. The file tells the planner to call
  // current_project and list_memories at start-of-session, and to prefer
  // Weaver memory over Claude Code's built-in auto-memory.
  const { join } = await import("node:path");
  const plannerCwd = join(ws.weaveDir, "projects", project.id);

  if (isFresh) {
    await newSession({
      name: plannerSession,
      cwd: plannerCwd,
      command: "claude",
      env: {
        WEAVER_WORKSPACE_ROOT: ws.root,
        WEAVER_PROJECT_ID: project.id,
      },
    });
    console.log(`✓ started planner tmux session ${plannerSession}`);

    const workerPanes = await buildPlannerLayout(plannerSession, opts.panes, { cwd: plannerCwd });
    // Return focus to the planner so the user lands in Claude, not a worker.
    await selectPane(`${plannerSession}:0.0`);
    console.log(`✓ laid out ${workerPanes.length} worker pane(s) on the right (planner on left)`);
  } else {
    const existing = await listPanes(plannerSession);
    console.log(`✓ planner tmux session ${plannerSession} already running (${existing.length} pane(s))`);
    console.log(`  (layout preserved — to rebuild, \`weave remove ${project.id}\` then \`weave up\` again)`);
    await selectPane(`${plannerSession}:0.0`);
  }

  // Always refresh the status bar — the project name or linear ticket may have
  // changed since the session was first created.
  const ticket = project.linearTicket ? ` | ${project.linearTicket}` : "";
  await setStatusLeft(plannerSession, ` weaver | ${project.name}${ticket} `);

  await openGhostty({ tmuxSession: plannerSession });
  console.log(`\n✓ Ghostty attached. Planner is on the left, bound to project ${project.id}.`);
  console.log(`  MCP context: workspace=${ws.root}, project=${project.id}`);
}
