import { join, resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { workspacePaths, type Workspace } from "./workspace.ts";
import { slugify, worktreeName as deriveWorktreeName } from "./ids.ts";

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
  // Per-project planner binary override. Falls back to ~/.weave/config.json's
  // planner.binary, then to "claude". Set at `weave new --planner codex`.
  plannerBinary?: "claude" | "codex" | string;
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
  opts: { name: string; linearTicket?: string; plannerBinary?: string },
): Promise<ProjectRecord> {
  if (!opts.name?.trim()) throw new Error("project name is required");

  // Id is derived from the name — human-readable, filesystem-navigable,
  // appears in tmux session names, MCP responses, and CLAUDE.md. On
  // collision, suffix with -2, -3, ... so duplicates still land cleanly.
  const id = await uniqueProjectSlug(workspace, opts.name);
  const p = projectPaths(workspace.root, id);
  await mkdir(p.base, { recursive: true });
  await mkdir(p.worktreesDir, { recursive: true });

  const now = new Date().toISOString();
  const record: ProjectRecord = {
    id,
    name: opts.name,
    linearTicket: opts.linearTicket,
    workspaceRoot: workspace.root,
    plannerBinary: opts.plannerBinary,
    worktrees: {},
    createdAt: now,
    updatedAt: now,
  };
  await Bun.write(p.meta, JSON.stringify(record, null, 2) + "\n");
  await Bun.write(p.notes, `# ${record.name}\n\nCreated ${now}\n${opts.linearTicket ? `\nLinear: ${opts.linearTicket}\n` : ""}`);
  // Pre-trust the project folder + every registered repo in codex's config
  // so codex workers don't hit the "trust this folder?" interactive prompt
  // when dispatched into them. Idempotent — won't add duplicates.
  await trustInCodexConfig([p.base, ...Object.values(workspace.config.repos).map((r) => r.path)]);
  // Write CLAUDE.md (read by claude planner) AND AGENTS.md (read by codex
  // planner). Same orchestration brief — codex doesn't read CLAUDE.md and
  // claude doesn't read AGENTS.md, but both should learn to dispatch via
  // `weave dispatch` instead of doing work themselves.
  const brief = buildPlannerBrief(record, workspace);
  await Bun.write(join(p.base, "CLAUDE.md"), brief);
  await Bun.write(join(p.base, "AGENTS.md"), brief);
  return record;
}

async function uniqueProjectSlug(workspace: Workspace, name: string): Promise<string> {
  const base = slugify(name) || "project";
  const projectsDir = workspacePaths(workspace.root).projectsDir;
  let candidate = base;
  let suffix = 2;
  while (await Bun.file(join(projectsDir, candidate, "project.json")).exists()) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

// Orchestration brief written to BOTH CLAUDE.md and AGENTS.md when a project
// is created. Claude reads CLAUDE.md, codex reads AGENTS.md — same content so
// the user can pick either as the planner binary and get the same dispatch
// instructions.
//
// Why Bash + CLI commands instead of MCP tools: CHA-1012 — Claude Code 2.1.119
// stdio MCP servers don't advertise tools to the model. Until that's fixed
// upstream, we route dispatch through the shell. The MCP server still exists
// for memory + project-state reads, but workers are controlled via Bash.
// Exported so `weave up` can regenerate CLAUDE.md/AGENTS.md from the latest
// template every run. Briefs are product-owned (not user-owned) — user voice
// + customization belongs in ~/.weave/USER.md, which is auto-appended via
// claude's --append-system-prompt and survives. This way the planner always
// gets the current orchestration rules without users having to recreate
// projects when we ship brief changes.
export function buildPlannerBrief(project: ProjectRecord, workspace: Workspace): string {
  const linear = project.linearTicket ? `\n- **Linear ticket**: ${project.linearTicket}` : "";
  const repos = Object.values(workspace.config.repos);
  const repoList = repos.length
    ? repos.map((r) => `  - \`${r.name}\`${r.role ? ` (${r.role})` : ""} — ${r.path}`).join("\n")
    : "  (none registered — use `weave repo add`)";
  return `# Weaver project: ${project.name}

You are the **main planner** for a Weaver-managed project. Your job is decomposition + dispatch + summarization. **You do not execute tasks yourself.**

- **Project id**: \`${project.id}\`${linear}
- **Workspace**: \`${workspace.root}\`
- **Registered repos**:
${repoList}

## The rule — dispatch via the /weaver:dispatch-batch slash command

The Weaver plugin gives you two slash commands:

* \`/weaver:dispatch-batch '<json>'\` — fan out N tasks to N worker panes in parallel, block until all done, return aggregated results. **Use this whenever you have 2+ workers, OR whenever the user asks for "N workers", "all the workers", "fan out", "split", etc.**
* \`/weaver:dispatch worker-N "<task>"\` — single-worker form. Use only when explicitly asked to dispatch to a SPECIFIC worker by name (e.g. "send this to worker-2") OR when the task is a single thing with no fan-out.

**Disambiguating user requests**: "ask 4 workers what is X" means dispatch-batch with 4 workers. "ask worker-4 what is X" means dispatch (single) to slot 4. Never assume "4" alone means "worker-4" — clarify or default to dispatch-batch with N workers if numerals appear without "worker-" prefix.

## Never hallucinate a worker's answer

If a worker doesn't return real text (timeout, error, the tool output is "(no result captured)" or similar), say so. **Do not** synthesize an answer from your own knowledge and present it as the worker's response. The whole point of dispatching is the worker actually doing the work; if it didn't, the user needs to know so they can retry.

You do NOT shell out to \`weave dispatch\` / \`weave tail\` directly. The slash command's subagent does that for you and returns clean text.

### Calling /weaver:dispatch-batch

The argument is a JSON object mapping worker slot ids to tasks. Two value forms supported:

\`\`\`
/weaver:dispatch-batch '{
  "worker-1": "plain task string",
  "worker-2": {
    "task": "task with overrides",
    "binary": "codex",
    "bypass": true,
    "model": "claude-opus-4",
    "cwd": "/Users/pom/Code/some-other-repo"
  }
}'
\`\`\`

Top-level flags applied to every worker that doesn't override:
\`--binary codex\`, \`--bypass\`, \`--model X\`, \`--cwd /path\`.

The N is 1..4 (or however many panes \`weave up --panes N\` made — call \`weave panes --project ${project.id}\` if unsure). Workers run in parallel and are visible live in their tmux panes. The slash command returns a deterministic block per worker:

\`\`\`
===== worker-1 =====
<final assistant text>

===== worker-2 =====
<final assistant text>
\`\`\`

Read the blocks, decide next move, call /weaver:dispatch-batch again with new tasks if needed, or summarize and stop.

### What you'll see back

\`/weaver:dispatch-batch\` blocks until every worker finishes, then returns one labeled block per worker:

\`\`\`
===== worker-1 =====
<final assistant text from worker-1>

===== worker-2 =====
<final assistant text from worker-2>
\`\`\`

Read the blocks, decide the next move:
- More dispatches? Call \`/weaver:dispatch-batch\` again with new tasks.
- Done? Reply with the final summary to the user.
- Need clarification? Ask the user — they're watching this pane.

### Read vs edit

Reading source files in THIS pane (Read tool, grep, cat, ls, git log) for context is fine — that's analysis. **Editing files / running tests of new code / making commits in this pane is forbidden.** If something needs to land on disk, dispatch a worker. No exceptions for "this one's small."

### Manual fallback (only if /weaver:dispatch-batch is unavailable)

If the slash command isn't installed, fall back to direct CLI calls:
1. \`weave dispatch worker-N "<task>"\` (defaults --cwd to your current cwd)
2. \`weave tail worker-N --wait-done\` to block until done
3. Aggregate yourself.

But in the normal case, prefer \`/weaver:dispatch-batch\` — it parallelizes for you.

## The 7-step loop (per top-level user request)

1. **Tell** — restate the user's goal in your own words.
2. **Analyze** — identify subtasks, dependencies, parallelism.
3. **Create** — if subtasks need isolation, create a worktree per subtask via \`weave\` or \`git worktree add\`.
4. **Spawn** — \`weave dispatch worker-N "<subtask>"\` for each, in parallel.
5. **Distribute** — record which worker owns which subtask.
6. **Monitor** — \`weave tail worker-N --wait-done\` for each, in parallel; if any fails, dispatch a debug worker.
7. **Summarize** — report consolidated results, link to PRs / Linear if relevant.

## Weaver memory

\`~/.weave/memory/\` holds standing rules, architectural decisions, testing conventions, PR workflow. Read at session start:

- \`weave memory list\` (or read \`~/.weave/memory/\` directly)
- When the user states a standing preference ("we always X", "the rule is Y"), record it: \`weave memory remember <category> "<rule>"\`.

## Repos in this workspace

Workers should run in the right repo for the task. If a task spans frontend + backend, dispatch one worker per repo.
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

// Append codex `[projects."<path>"] trust_level = "trusted"` blocks to
// ~/.codex/config.toml for any path not already trusted. Without this,
// dispatched codex workers hit the interactive "Do you trust this folder?"
// prompt when their cwd isn't a git repo (e.g. .weaver/projects/<id>/), and
// the prompt blocks the worker indefinitely because there's no human at the
// worker pane to answer. Idempotent — skips paths already in the config.
async function trustInCodexConfig(paths: string[]): Promise<void> {
  const { homedir } = await import("node:os");
  const configPath = `${homedir()}/.codex/config.toml`;
  let existing = "";
  try {
    if (await Bun.file(configPath).exists()) existing = await Bun.file(configPath).text();
  } catch { /* config doesn't exist yet — fine, we'll create */ }
  const additions: string[] = [];
  for (const path of paths) {
    if (!path) continue;
    // Match the codex TOML form: [projects."/abs/path"]
    if (existing.includes(`[projects."${path}"]`)) continue;
    additions.push(`\n[projects."${path}"]\ntrust_level = "trusted"`);
  }
  if (additions.length === 0) return;
  const next = (existing.endsWith("\n") || existing === "") ? existing : existing + "\n";
  await Bun.write(configPath, next + additions.join("\n") + "\n");
}
