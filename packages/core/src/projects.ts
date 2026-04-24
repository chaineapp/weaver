import { join, resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { workspacePaths, type Workspace } from "./workspace.ts";
import { newProjectId, worktreeName as deriveWorktreeName } from "./ids.ts";

// A Project is the user's unit of work — bound to one planner Claude session,
// spanning 1..N repos via git worktrees. Lives under <workspace>/.weaver/projects/<id>/.

export type WorktreeRecord = {
  name: string;         // derived: <repo>-<branch-slug>[-<linear>]
  repoName: string;     // matches an entry in workspace.config.repos
  repoPath: string;     // absolute
  branch: string;
  linearTicket?: string;
  path: string;         // absolute — where the git worktree actually lives
  tmuxSession: string;  // `weave-<projectId>-<worktree>`
  createdAt: string;
};

export type ProjectRecord = {
  id: string;
  name: string;
  linearTicket?: string;
  workspaceRoot: string;
  claudeSessionId?: string;
  worktrees: Record<string, WorktreeRecord>;  // keyed by worktree name
  createdAt: string;
  updatedAt: string;
};

function projectPaths(workspaceRoot: string, id: string) {
  const base = join(workspacePaths(workspaceRoot).projectsDir, id);
  return {
    base,
    meta: join(base, "project.json"),
    worktreesDir: join(base, "worktrees"),
    notes: join(base, "notes.md"),
  };
}

export async function createProject(
  workspace: Workspace,
  opts: { name?: string; linearTicket?: string } = {},
): Promise<ProjectRecord> {
  const id = newProjectId();
  const p = projectPaths(workspace.root, id);
  await mkdir(p.base, { recursive: true });
  await mkdir(p.worktreesDir, { recursive: true });

  const now = new Date().toISOString();
  const record: ProjectRecord = {
    id,
    name: opts.name ?? id,
    linearTicket: opts.linearTicket,
    workspaceRoot: workspace.root,
    worktrees: {},
    createdAt: now,
    updatedAt: now,
  };
  await Bun.write(p.meta, JSON.stringify(record, null, 2) + "\n");
  await Bun.write(p.notes, `# ${record.name}\n\nCreated ${now}\n${opts.linearTicket ? `\nLinear: ${opts.linearTicket}\n` : ""}`);
  await Bun.write(join(p.base, "CLAUDE.md"), buildPlannerClaudeMd(record, workspace));
  return record;
}

// CLAUDE.md read by the planner Claude on session start. Claude Code walks up
// the dir tree for CLAUDE.md, so dropping one at the project folder means
// every `weave up --project <id>` planner sees it.
function buildPlannerClaudeMd(project: ProjectRecord, workspace: Workspace): string {
  const linear = project.linearTicket ? `\n- **Linear ticket**: ${project.linearTicket}` : "";
  const repos = Object.values(workspace.config.repos);
  const repoList = repos.length
    ? repos.map((r) => `  - \`${r.name}\`${r.role ? ` (${r.role})` : ""} — ${r.path}`).join("\n")
    : "  (none registered — use `register_repo` or `weave repo add`)";
  return `# Weaver project: ${project.name}

You are the **planner** for a Weaver-managed project. A Weaver MCP server is wired to this session (env: WEAVER_PROJECT_ID, WEAVER_WORKSPACE_ROOT).

- **Project id**: \`${project.id}\`${linear}
- **Workspace**: \`${workspace.root}\`
- **Registered repos**:
${repoList}

## First thing, every session — call these MCP tools

1. \`current_project()\` — returns this project's metadata, registered repos, and existing worktrees. Do this BEFORE you propose anything.
2. \`list_memories()\` — shows standing rules and prior decisions written to Weaver's memory at \`~/.weave/memory/\`. Skim titles; \`read_memory\` anything directly relevant.
3. If the task has subtasks that can run in parallel, plan to use \`create_worktree\` + \`spawn_pane\` + \`wait_for_updates\`. Read \`patterns/parallel-dispatch.md\` from memory.

## Weaver memory vs Claude Code's built-in auto-memory

They are different systems.

- **Weaver memory** (~/.weave/memory/) — what you access via \`list_memories\`, \`search_memories\`, \`read_memory\`, \`remember\`. This is the source of truth for standing preferences, architectural decisions, testing conventions, PR workflow.
- **Claude Code auto-memory** (~/.claude/projects/.../memory/) — Claude Code's own per-cwd memory system. Contains prior-session observations. Useful but may be stale and may reference work unrelated to this project.

**When there's a conflict, Weaver memory wins.** If you see Claude Code recalling something that looks off-topic for THIS project, ignore it in favor of \`current_project\` + Weaver memory.

## Auto-remember

When the user states a standing preference, architectural decision, testing convention, or PR workflow rule that is not tied to one task — call \`remember()\` IMMEDIATELY. Do not wait until the end of the session.

Example triggers:
- "we always X"
- "never do Y"
- "the rule is Z"
- "make sure to …"

Categories: \`architecture\`, \`patterns\`, \`testing\`, \`pr-behavior\`, \`runbooks\`, \`glossary\`.

## For task execution

- **Plan before creating worktrees.** Present the breakdown, propose a parallelism count, wait for user sign-off.
- Use \`create_worktree({repo_name, branch, linear_ticket?})\` to add a git worktree under this project.
- Use \`spawn_pane({worktree_name, task})\` to run a Codex worker in a tmux pane inside that worktree.
- Use \`wait_for_updates({timeout_seconds: 30})\` in a loop after spawning — do not ask the user to re-prompt you for updates. Summarize completed panes back to the user proactively.
`;
}

export async function getProject(workspace: Workspace, id: string): Promise<ProjectRecord | null> {
  const p = projectPaths(workspace.root, id);
  const file = Bun.file(p.meta);
  if (!(await file.exists())) return null;
  return (await file.json()) as ProjectRecord;
}

export async function saveProject(workspace: Workspace, record: ProjectRecord): Promise<void> {
  record.updatedAt = new Date().toISOString();
  const p = projectPaths(workspace.root, record.id);
  await Bun.write(p.meta, JSON.stringify(record, null, 2) + "\n");
}

export async function listProjects(workspace: Workspace): Promise<ProjectRecord[]> {
  const glob = new Bun.Glob("*/project.json");
  const out: ProjectRecord[] = [];
  for await (const relative of glob.scan({ cwd: workspacePaths(workspace.root).projectsDir })) {
    const file = Bun.file(join(workspacePaths(workspace.root).projectsDir, relative));
    if (await file.exists()) out.push((await file.json()) as ProjectRecord);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function deleteProject(workspace: Workspace, id: string, opts: { removeWorktrees?: boolean } = {}): Promise<void> {
  const project = await getProject(workspace, id);
  if (!project) return;
  if (opts.removeWorktrees) {
    for (const wt of Object.values(project.worktrees)) {
      try {
        await Bun.$`git -C ${wt.repoPath} worktree remove --force ${wt.path}`.quiet();
      } catch {
        /* ignore */
      }
    }
  }
  await rm(projectPaths(workspace.root, id).base, { recursive: true, force: true });
}

// Actually add a git worktree on disk and register it on the project.
export async function addWorktree(
  workspace: Workspace,
  project: ProjectRecord,
  opts: {
    repoName: string;       // must exist in workspace.config.repos
    branch: string;
    baseBranch?: string;    // used if branch doesn't exist; default 'main'
    linearTicket?: string;
  },
): Promise<WorktreeRecord> {
  const repo = workspace.config.repos[opts.repoName];
  if (!repo) throw new Error(`unknown repo: ${opts.repoName} — register it in workspace config first`);
  const linear = opts.linearTicket ?? project.linearTicket;
  const name = deriveWorktreeName(repo.name, opts.branch, linear);
  if (project.worktrees[name]) return project.worktrees[name];

  const p = projectPaths(workspace.root, project.id);
  const wtPath = resolve(p.worktreesDir, name);

  // Does the branch exist on the source repo?
  const branchCheck = Bun.spawn(["git", "-C", repo.path, "rev-parse", "--verify", opts.branch], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const branchExists = (await branchCheck.exited) === 0;

  if (branchExists) {
    await runOrThrow(["git", "-C", repo.path, "worktree", "add", wtPath, opts.branch]);
  } else {
    const base = opts.baseBranch ?? "main";
    await runOrThrow(["git", "-C", repo.path, "worktree", "add", "-b", opts.branch, wtPath, base]);
  }

  const record: WorktreeRecord = {
    name,
    repoName: repo.name,
    repoPath: repo.path,
    branch: opts.branch,
    linearTicket: linear,
    path: wtPath,
    tmuxSession: `weave-${project.id}-${name}`,
    createdAt: new Date().toISOString(),
  };
  project.worktrees[name] = record;
  await saveProject(workspace, project);
  return record;
}

export async function removeWorktree(workspace: Workspace, project: ProjectRecord, worktreeName: string): Promise<void> {
  const wt = project.worktrees[worktreeName];
  if (!wt) return;
  try {
    await Bun.$`git -C ${wt.repoPath} worktree remove --force ${wt.path}`.quiet();
  } catch {
    /* ignore — user may have already removed */
  }
  delete project.worktrees[worktreeName];
  await saveProject(workspace, project);
}

async function runOrThrow(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${args.join(" ")} failed (${code}): ${stderr.trim()}`);
  return stdout;
}
