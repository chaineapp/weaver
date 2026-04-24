import { join, resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

// A "workspace" is the directory a user works out of — typically ~/Code.
// It holds a .weaver/ dir with workspace-level config, the projects registry,
// and every project's worktree folders. Workspaces are discovered by walking
// up from cwd looking for .weaver/ (similar to CLAUDE.md / .git resolution).

export type RepoEntry = {
  name: string;       // short id, e.g. "chain5", "chain-zen"
  path: string;       // absolute path to the repo root
  role?: string;      // optional tag, e.g. "backend", "frontend"
};

export type WorkspaceConfig = {
  version: 1;
  repos: Record<string, RepoEntry>;
  createdAt: string;
};

export type Workspace = {
  root: string;                 // absolute path, e.g. /Users/pom/Code
  weaveDir: string;             // <root>/.weaver
  config: WorkspaceConfig;
};

export function workspacePaths(root: string) {
  const weaveDir = join(root, ".weaver");
  return {
    root,
    weaveDir,
    config: join(weaveDir, "config.json"),
    projectsDir: join(weaveDir, "projects"),
  };
}

export async function findWorkspace(startDir: string = process.cwd()): Promise<Workspace | null> {
  let dir = resolve(startDir);
  while (true) {
    const p = workspacePaths(dir);
    if (await Bun.file(p.config).exists()) {
      const config = (await Bun.file(p.config).json()) as WorkspaceConfig;
      return { root: dir, weaveDir: p.weaveDir, config };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function findOrThrow(startDir?: string): Promise<Workspace> {
  const ws = await findWorkspace(startDir);
  if (!ws) throw new Error("not inside a Weaver workspace — run `weave workspace init` first");
  return ws;
}

export async function initWorkspace(root: string, repos: RepoEntry[] = []): Promise<Workspace> {
  const p = workspacePaths(root);
  await mkdir(p.weaveDir, { recursive: true });
  await mkdir(p.projectsDir, { recursive: true });

  const existing = await Bun.file(p.config).exists()
    ? ((await Bun.file(p.config).json()) as WorkspaceConfig)
    : null;

  const reposById: Record<string, RepoEntry> = { ...(existing?.repos ?? {}) };
  for (const r of repos) reposById[r.name] = r;

  const config: WorkspaceConfig = {
    version: 1,
    repos: reposById,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await Bun.write(p.config, JSON.stringify(config, null, 2) + "\n");
  return { root, weaveDir: p.weaveDir, config };
}

export async function addRepo(workspace: Workspace, repo: RepoEntry): Promise<void> {
  workspace.config.repos[repo.name] = repo;
  await Bun.write(
    workspacePaths(workspace.root).config,
    JSON.stringify(workspace.config, null, 2) + "\n",
  );
}
