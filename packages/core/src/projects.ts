import { weavePaths } from "./paths.ts";
import { resolve, basename } from "node:path";

// Projects own one or more worktrees. The main checkout is always registered
// under the worktree id "main". Agent-created worktrees land under their own
// ids, derived from the directory basename when not supplied.

export type Worktree = {
  id: string;               // "main", "feature-x", ...
  path: string;             // absolute canonical path of the working tree
  branch?: string;          // resolved once; not kept in sync (cheap)
  tmuxSession: string;      // tmux session name for this worktree's Ghostty window
  createdAt: string;
};

export type Project = {
  id: string;               // unique: usually the repo's directory basename
  name: string;             // display name
  rootPath: string;         // absolute path of the main checkout
  worktrees: Record<string, Worktree>;
  createdAt: string;
};

type ProjectsFile = {
  version: 1;
  projects: Record<string, Project>;
};

async function load(): Promise<ProjectsFile> {
  const file = Bun.file(weavePaths().projects);
  if (!(await file.exists())) return { version: 1, projects: {} };
  return (await file.json()) as ProjectsFile;
}

async function save(data: ProjectsFile): Promise<void> {
  await Bun.write(weavePaths().projects, JSON.stringify(data, null, 2) + "\n");
}

export async function listProjects(): Promise<Project[]> {
  const data = await load();
  return Object.values(data.projects);
}

export async function getProject(id: string): Promise<Project | null> {
  const data = await load();
  return data.projects[id] ?? null;
}

// Resolve a directory path to (projectId, worktreeId), registering if new.
// The caller gives us any path; we figure out whether it belongs to an existing
// project (by matching rootPath prefix), or is a brand-new project.
export async function resolveOrRegister(inputPath: string): Promise<{
  project: Project;
  worktree: Worktree;
  created: boolean;
}> {
  const abs = resolve(inputPath);
  const data = await load();

  // 1. Existing worktree hit?
  for (const project of Object.values(data.projects)) {
    for (const w of Object.values(project.worktrees)) {
      if (abs === w.path) {
        return { project, worktree: w, created: false };
      }
    }
  }

  // 2. Path is under an existing project's root but not registered as a worktree?
  //    Register it as a new worktree under that project.
  for (const project of Object.values(data.projects)) {
    if (abs.startsWith(project.rootPath + "/") || abs === project.rootPath) {
      const worktreeId = abs === project.rootPath ? "main" : uniqueWorktreeId(project, abs);
      const worktree: Worktree = {
        id: worktreeId,
        path: abs,
        tmuxSession: `weave-${project.id}-${worktreeId}`,
        createdAt: new Date().toISOString(),
      };
      project.worktrees[worktreeId] = worktree;
      data.projects[project.id] = project;
      await save(data);
      return { project, worktree, created: true };
    }
  }

  // 3. Brand-new project.
  const projectId = uniqueProjectId(data, abs);
  const worktree: Worktree = {
    id: "main",
    path: abs,
    tmuxSession: `weave-${projectId}`,
    createdAt: new Date().toISOString(),
  };
  const project: Project = {
    id: projectId,
    name: basename(abs),
    rootPath: abs,
    worktrees: { main: worktree },
    createdAt: new Date().toISOString(),
  };
  data.projects[projectId] = project;
  await save(data);
  return { project, worktree, created: true };
}

function uniqueProjectId(data: ProjectsFile, path: string): string {
  const base = basename(path);
  if (!data.projects[base]) return base;
  // Collision — append a short suffix from the parent dir
  const parts = path.split("/").filter(Boolean);
  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = `${parts[i]}-${base}`;
    if (!data.projects[candidate]) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function uniqueWorktreeId(project: Project, worktreePath: string): string {
  const base = basename(worktreePath);
  if (!project.worktrees[base]) return base;
  return `${base}-${Date.now().toString(36)}`;
}

export async function removeProject(id: string): Promise<void> {
  const data = await load();
  delete data.projects[id];
  await save(data);
}
