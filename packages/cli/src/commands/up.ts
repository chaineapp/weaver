import { findWorkspace, getProject, listProjects, readConfig, readUserMd, upsertPaneRecord, weavePaths } from "@weaver/core";
import { hasSession, newSession, listPanes, openGhostty, openGhosttyTab, isInsideGhostty, buildPlannerLayout, selectPane, setStatusLeft, installWeaverMenu, sendKeys, pipePane } from "@weaver/tmux";
import { playBanner } from "../banner.ts";

// Build the command string used to launch the planner agent inside tmux.
// Exported for unit-testing — avoids re-running the whole CLI to check flags.
// Bypass flag is only auto-added for `claude`; custom binaries must use
// extraArgs to supply their own permission-skip equivalent.
//
// userMd: contents of ~/.weave/USER.md (Weaver product context + user voice).
// When present and binary is claude, we append it via --append-system-prompt
// so the planner sees it as part of its system prompt for every session.
// For codex (no equivalent flag), we prepend it to extraArgs as a comment;
// codex will see it on stdin and treat as initial context.
export function buildPlannerCommand(opts: {
  binary?: string;
  bypass?: boolean;
  model?: string;
  extraArgs?: string;
  userMd?: string;
} = {}): string {
  const binary = opts.binary || "claude";
  const parts = [binary];
  if (opts.bypass && binary === "claude") parts.push("--dangerously-skip-permissions");
  if (opts.model) parts.push("--model", opts.model);
  if (opts.userMd && binary === "claude") {
    parts.push("--append-system-prompt", shellQuote(opts.userMd));
  }
  if (opts.extraArgs) parts.push(opts.extraArgs);
  return parts.join(" ");
}

// Single-quote a string for safe inclusion in a shell command. Handles inner
// single quotes by closing, escaping, reopening — standard POSIX trick.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// `weave up --project <id> --panes <workers>`:
//   - creates tmux session weave-<id> if missing, pane 0 runs `claude`
//   - builds a planner-left + workers-grid-right layout on first creation
//   - opens Ghostty attached to the session
//
// --panes N = number of WORKER panes on the right (1..6). The planner is
// always in addition. So --panes 4 gives you: 1 planner + 2x2 workers.

export async function runUp(opts: { project?: string; panes: number; bypass?: boolean }): Promise<void> {
  await playBanner("weaver — coding agent orchestrator");
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

  // Resolve planner flags. Precedence: explicit --bypass flag > WEAVER_CLAUDE_BYPASS env > ~/.weave/config.json > off.
  // Planner binary precedence: project.plannerBinary > config > "claude".
  const cfg = await readConfig();
  const envBypass = process.env.WEAVER_CLAUDE_BYPASS === "1";
  const bypass = opts.bypass ?? envBypass ?? cfg?.planner?.bypass ?? false;
  const plannerBinary = project.plannerBinary ?? cfg?.planner?.binary ?? "claude";
  // ~/.weave/USER.md (Weaver context + user voice) is auto-appended to the
  // planner's system prompt. weave init writes a default stub; user edits it.
  // Belt-and-suspenders: also create on first `weave up` for users who
  // installed before USER.md existed (idempotent — never overwrites).
  {
    const { defaultUserMd } = await import("@weaver/core");
    if (!(await Bun.file(weavePaths().userMd).exists())) {
      await Bun.write(weavePaths().userMd, defaultUserMd());
      console.log(`✓ scaffolded ${weavePaths().userMd} (edit to customize planner voice + standing prefs)`);
    }
  }
  const userMd = await readUserMd();
  const plannerCmd = buildPlannerCommand({
    binary: plannerBinary,
    bypass,
    model: cfg?.planner?.model,
    extraArgs: cfg?.planner?.extraArgs,
    userMd: userMd ?? undefined,
  });

  if (isFresh) {
    await newSession({
      name: plannerSession,
      cwd: plannerCwd,
      command: plannerCmd,
      env: {
        WEAVER_WORKSPACE_ROOT: ws.root,
        WEAVER_PROJECT_ID: project.id,
      },
    });
    console.log(`✓ started planner tmux session ${plannerSession}${bypass ? " (bypass permissions ON)" : ""}`);

    const workerPanes = await buildPlannerLayout(plannerSession, opts.panes, { cwd: plannerCwd });

    // Register every layout pane in the global pane registry so:
    //   1. `weave panes --project <id>` lists them.
    //   2. `weave dispatch worker-N <task>` can resolve worker-N → tmux pane id.
    //   3. `weave tail worker-N` can read the right run file.
    // Workers start as bash shells (status: "idle"). The actual codex/claude
    // process is launched by `weave dispatch` on first task.
    const now = new Date().toISOString();
    const workerBinary = cfg?.worker?.binary ?? "codex";
    for (const w of workerPanes) {
      const runFile = weavePaths().runFile(w.paneId);
      await pipePane(w.paneId, runFile);
      // Print a one-line ready indicator in each worker pane so the user sees
      // structured slots, not just blank shells.
      await sendKeys(w.paneId, `printf '\\033[2m# weaver worker-${w.workerNum} idle — dispatch with: weave dispatch worker-${w.workerNum} "<task>"\\033[0m\\n'`, true);
      await upsertPaneRecord({
        id: w.paneId,
        workspaceRoot: ws.root,
        projectId: project.id,
        worktreeName: "",
        task: "",
        status: "idle",
        tmuxSession: plannerSession,
        runFile,
        lastReviewedByte: 0,
        workerNum: w.workerNum,
        binary: workerBinary,
        createdAt: now,
        updatedAt: now,
      });
    }
    // Return focus to the planner so the user lands in the planner, not a worker.
    await selectPane(`${plannerSession}:0.0`);
    console.log(`✓ laid out ${workerPanes.length} worker pane(s) — registered as worker-1..worker-${workerPanes.length} (binary: ${workerBinary})`);
  } else {
    const existing = await listPanes(plannerSession);
    console.log(`✓ planner tmux session ${plannerSession} already running (${existing.length} pane(s))`);
    console.log(`  (layout preserved — to rebuild, \`weave remove ${project.id}\` then \`weave up\` again)`);
    await selectPane(`${plannerSession}:0.0`);
  }

  // Status bar: project name + linear ticket + active flags so the user can
  // see at a glance whether bypass is on. Refreshed on every `weave up`.
  const ticket = project.linearTicket ? ` | ${project.linearTicket}` : "";
  const flags = bypass ? " | bypass" : "";
  await setStatusLeft(plannerSession, ` weaver | ${project.name}${ticket}${flags}  [F12=menu] `);

  // In-Ghostty control surface — F12 opens a menu with bypass toggles,
  // restart-planner, version, config list, and a custom `weave>` prompt.
  await installWeaverMenu();

  // Eval / CI escape hatch: skip opening Ghostty when WEAVER_NO_GHOSTTY=1.
  // The tmux session is still live and the planner is still running — useful
  // for headless eval runs that drive the planner via tmux send-keys without
  // popping a window onto the user's screen.
  if (process.env.WEAVER_NO_GHOSTTY === "1") {
    console.log(`\n✓ tmux session ${plannerSession} ready (Ghostty skipped — WEAVER_NO_GHOSTTY=1)`);
    console.log(`  Attach manually with: tmux attach -t ${plannerSession}`);
    console.log(`  MCP context: workspace=${ws.root}, project=${project.id}`);
    return;
  }

  // If we're already inside a Ghostty terminal, open this project as a TAB
  // in the current window — keeps everything in one window, tab title shows
  // the project name. Falls back to a new window if AppleScript can't drive
  // Ghostty (e.g. no Accessibility permission).
  let opened: "tab" | "window" = "window";
  if (isInsideGhostty()) {
    const tabOk = await openGhosttyTab({
      tmuxSession: plannerSession,
      title: project.name,
    });
    if (tabOk) opened = "tab";
  }
  if (opened === "window") {
    await openGhostty({ tmuxSession: plannerSession });
  }

  console.log(
    `\n✓ Ghostty ${opened === "tab" ? "tab opened" : "window opened"} for ${project.name} (${project.id}).`,
  );
  console.log(`  MCP context: workspace=${ws.root}, project=${project.id}`);
  if (opened === "window" && isInsideGhostty()) {
    console.log(
      `  (couldn't open as a tab — grant Ghostty Accessibility permission in System Settings to enable tabs)`,
    );
  }
}
