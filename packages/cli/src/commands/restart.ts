import { homedir } from "node:os";
import { join } from "node:path";
import { findWorkspace, getProject, readConfig, weavePaths } from "@weaver/core";
import { setStatusLeft } from "@weaver/tmux";
import { buildPlannerCommand } from "./up.ts";

// `weave restart-planner --project <id> --bypass|--no-bypass [--model M]`
//
// Respawns the claude process in pane 0 with new flags. Claude Code stores
// session transcripts at ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
// — we find the newest one for the planner's cwd and resume it so the user
// doesn't lose their conversation context.

type RestartOpts = {
  project?: string;
  bypass?: boolean;
  noBypass?: boolean;
  model?: string;
};

// Claude Code's cwd encoding: replace every non-alphanumeric char with `-`.
// Verified against ~/.claude/projects/ on the user's machine.
function encodeClaudeCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

async function latestClaudeSession(cwd: string): Promise<string | null> {
  const dir = join(homedir(), ".claude", "projects", encodeClaudeCwd(cwd));
  try {
    const glob = new Bun.Glob("*.jsonl");
    let newest: { name: string; mtime: number } | null = null;
    for await (const entry of glob.scan({ cwd: dir, absolute: false })) {
      const stat = await Bun.file(join(dir, entry)).stat();
      const mtime = stat.mtime.getTime();
      if (!newest || mtime > newest.mtime) newest = { name: entry, mtime };
    }
    return newest ? newest.name.replace(/\.jsonl$/, "") : null;
  } catch {
    return null;
  }
}

async function tmuxRespawnPane(target: string, command: string): Promise<void> {
  // -k kills the existing process in the pane, replaces it with `command`.
  // The pane itself (and therefore the tmux session + layout + MCP env
  // vars) survives.
  const proc = Bun.spawn(["tmux", "respawn-pane", "-k", "-t", target, command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`tmux respawn-pane failed: ${stderr.trim()}`);
  }
}

export async function runRestartPlanner(opts: RestartOpts): Promise<void> {
  const ws = await findWorkspace();
  if (!ws) {
    console.error("not inside a Weaver workspace");
    process.exit(1);
  }

  let projectId = opts.project;
  if (!projectId) {
    const { listProjects } = await import("@weaver/core");
    const all = await listProjects(ws);
    if (all.length === 0) {
      console.error("no projects");
      process.exit(1);
    }
    projectId = all[0]!.id;
  }

  const project = await getProject(ws, projectId);
  if (!project) {
    console.error(`no project: ${projectId}`);
    process.exit(1);
  }

  const plannerCwd = join(weavePaths().weaveHome, "..", ws.weaveDir, "projects", project.id);
  // Actually — weavePaths() is ~/.weave, ws.weaveDir is <workspace>/.weaver.
  // Planner cwd is <workspace>/.weaver/projects/<id>/.
  const actualPlannerCwd = join(ws.weaveDir, "projects", project.id);

  // Resolve new flags. Precedence: explicit CLI > config > off.
  const cfg = await readConfig();
  let bypass: boolean;
  if (opts.bypass) bypass = true;
  else if (opts.noBypass) bypass = false;
  else bypass = cfg?.planner?.bypass ?? false;

  const model = opts.model ?? cfg?.planner?.model;
  const extraArgs = cfg?.planner?.extraArgs;

  // Find Claude session to resume.
  const sessionId = await latestClaudeSession(actualPlannerCwd);
  const resumeFlag = sessionId ? ` --resume ${sessionId}` : "";

  const baseCmd = buildPlannerCommand({ bypass, model, extraArgs });
  const fullCmd = baseCmd + resumeFlag;

  const tmuxTarget = `weave-${project.id}:0.0`;
  await tmuxRespawnPane(tmuxTarget, fullCmd);

  // Refresh status bar to reflect new flags.
  const ticket = project.linearTicket ? ` | ${project.linearTicket}` : "";
  const flags = bypass ? " | bypass" : "";
  await setStatusLeft(
    `weave-${project.id}`,
    ` weaver | ${project.name}${ticket}${flags}  [F12=menu] `,
  );

  console.log(`✓ restarted planner for ${project.id}`);
  console.log(`  command: ${fullCmd}`);
  if (sessionId) console.log(`  resumed Claude session: ${sessionId}`);
  else console.log(`  (no prior Claude session found — started fresh)`);

  // Suppress used-but-unused warning
  void plannerCwd;
}
