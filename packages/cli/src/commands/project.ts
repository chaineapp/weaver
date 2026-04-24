import { createInterface } from "node:readline/promises";
import { findWorkspace, createProject, listProjects, getProject, teardownProject } from "@weaver/core";

async function ask(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = fallback ? ` [${fallback}]` : "";
    const ans = (await rl.question(`${question}${suffix}: `)).trim();
    return ans || fallback;
  } finally {
    rl.close();
  }
}

// `weave new` with no flags drops into an interactive prompt — name + optional
// linear ticket — then offers to launch `weave up` immediately, so Cmd+T in
// a Ghostty tab gives you a one-flow new-project experience.
export async function runProjectNew(opts: {
  name?: string;
  linear?: string;
  thenUp?: boolean;
} = {}): Promise<void> {
  const ws = await findWorkspace();
  if (!ws) {
    console.error("not inside a Weaver workspace — run `weave workspace init` first");
    process.exit(1);
  }

  let name = opts.name;
  let linear = opts.linear;
  let interactive = false;
  if (!name) {
    interactive = true;
    if (!process.stdin.isTTY) {
      console.error("usage: weave new --name <name> [--linear CHA-XXX]");
      console.error("  (or run interactively in a TTY — this stdin isn't one)");
      process.exit(1);
    }
    name = await ask("project name", "");
    if (!name) {
      console.error("project name required");
      process.exit(1);
    }
    if (!linear) {
      const lin = await ask("linear ticket id (blank to skip)", "");
      if (lin) linear = lin;
    }
  }

  const p = await createProject(ws, { name, linearTicket: linear });
  console.log(`\n✓ created project ${p.id}`);
  console.log(`  name:     ${p.name}`);
  if (p.linearTicket) console.log(`  linear:   ${p.linearTicket}`);
  console.log(`  location: ${ws.root}/.weaver/projects/${p.id}/`);

  // If invoked interactively, immediately launch the planner in the current
  // tab — that's the whole point of "Cmd+T → answer two questions → coding".
  // --then-up=false to opt out.
  const shouldUp = opts.thenUp ?? interactive;
  if (shouldUp) {
    const { runUp } = await import("./up.ts");
    const { readConfig } = await import("@weaver/core");
    const cfg = await readConfig();
    const panes = cfg?.defaultPanes ?? 4;
    console.log(`\n→ launching planner with ${panes} worker pane(s)...\n`);
    await runUp({ project: p.id, panes });
    return;
  }

  console.log(`\nNext:  weave up --project ${p.id} --panes 4   (planner + 2x2 worker grid on right)`);
}

export async function runProjectList(): Promise<void> {
  const ws = await findWorkspace();
  if (!ws) {
    console.error("not inside a Weaver workspace");
    process.exit(1);
  }
  const projects = await listProjects(ws);
  if (projects.length === 0) {
    console.log("no projects yet — `weave new`");
    return;
  }
  for (const p of projects) {
    const wt = Object.keys(p.worktrees).length;
    const linear = p.linearTicket ? ` [${p.linearTicket}]` : "";
    console.log(`  ${p.id}  ${p.name}${linear}  (${wt} worktree${wt === 1 ? "" : "s"})`);
  }
}

export async function runProjectRemove(opts: { id: string; removeWorktrees?: boolean }): Promise<void> {
  const ws = await findWorkspace();
  if (!ws) {
    console.error("not inside a Weaver workspace");
    process.exit(1);
  }
  const p = await getProject(ws, opts.id);
  if (!p) {
    console.error(`no project with id ${opts.id}`);
    process.exit(1);
  }
  const result = await teardownProject(ws, opts.id, { removeWorktrees: opts.removeWorktrees });
  console.log(`✓ removed project ${opts.id}`);
  console.log(`  tmux sessions killed: ${result.tmuxSessionsKilled.length}`);
  console.log(`  panes removed:        ${result.panesRemoved.length}`);
  if (opts.removeWorktrees) console.log(`  worktrees removed:    ${result.worktreesRemoved.length}`);
}
