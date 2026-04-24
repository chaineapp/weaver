import { resolve } from "node:path";
import { initWorkspace, findWorkspace, addRepo } from "@weaver/core";

export async function runWorkspaceInit(opts: { path?: string }): Promise<void> {
  const root = resolve(opts.path ?? process.cwd());
  const ws = await initWorkspace(root);
  console.log(`✓ workspace initialized at ${ws.root}`);
  console.log(`  config: ${root}/.weaver/config.json`);
  console.log(`  repos:  ${Object.keys(ws.config.repos).length} registered`);
  if (Object.keys(ws.config.repos).length === 0) {
    console.log(`\nRegister repos:`);
    console.log(`  weave repo add chain5 ~/Code/chain5 --role backend`);
    console.log(`  weave repo add chain-zen ~/Code/chain-zen --role frontend`);
  }
}

export async function runRepoAdd(opts: { name: string; path: string; role?: string }): Promise<void> {
  const ws = await findWorkspace();
  if (!ws) {
    console.error("not inside a Weaver workspace — run `weave workspace init` first");
    process.exit(1);
  }
  const path = resolve(opts.path);
  await addRepo(ws, { name: opts.name, path, role: opts.role });
  console.log(`✓ registered repo '${opts.name}' -> ${path}${opts.role ? ` (${opts.role})` : ""}`);
}

export async function runRepoList(): Promise<void> {
  const ws = await findWorkspace();
  if (!ws) {
    console.error("not inside a Weaver workspace");
    process.exit(1);
  }
  const repos = Object.values(ws.config.repos);
  if (repos.length === 0) {
    console.log("no repos registered — `weave repo add <name> <path>`");
    return;
  }
  for (const r of repos) {
    console.log(`  ${r.name.padEnd(18)} ${r.role ? `[${r.role}]`.padEnd(12) : "".padEnd(12)} ${r.path}`);
  }
}
