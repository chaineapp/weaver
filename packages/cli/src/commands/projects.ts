import { listProjects } from "@weaver/core";

export async function runProjects(): Promise<void> {
  const projects = await listProjects();
  if (projects.length === 0) {
    console.log("no projects registered yet — run `weave up` in a repo");
    return;
  }
  for (const p of projects) {
    console.log(`${p.id}  (${p.rootPath})`);
    for (const w of Object.values(p.worktrees)) {
      const tag = w.id === "main" ? "" : `:${w.id}`;
      console.log(`  ${p.id}${tag.padEnd(20)}  ${w.path}`);
    }
  }
}
