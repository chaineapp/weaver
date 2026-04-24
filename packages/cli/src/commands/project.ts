import { findWorkspace, createProject, listProjects, getProject, deleteProject } from "@weaver/core";

export async function runProjectNew(opts: { name?: string; linear?: string }): Promise<void> {
  const ws = await findWorkspace();
  if (!ws) {
    console.error("not inside a Weaver workspace — run `weave workspace init` first");
    process.exit(1);
  }
  const p = await createProject(ws, { name: opts.name, linearTicket: opts.linear });
  console.log(`✓ created project ${p.id}`);
  console.log(`  name:     ${p.name}`);
  if (p.linearTicket) console.log(`  linear:   ${p.linearTicket}`);
  console.log(`  location: ${ws.root}/.weaver/projects/${p.id}/`);
  console.log(`\nNext:  weave up --project ${p.id} --panes 3`);
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
  await deleteProject(ws, opts.id, { removeWorktrees: opts.removeWorktrees });
  console.log(`✓ removed project ${opts.id}${opts.removeWorktrees ? " (+ worktrees)" : ""}`);
}
