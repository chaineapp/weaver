import { z } from "zod";
import { resolve } from "node:path";
import {
  listPaneRecords,
  getPaneRecord,
  removePaneRecord,
  readEvents,
  paneSummary,
  setLastReviewedByte,
  waitForUpdates,
  listProjects,
  createProject,
  addWorktree,
  removeWorktree,
  addRepo,
  findWorkspace,
  listMemories,
  readMemory,
  searchMemories,
  recentMemories,
  remember,
  forget,
  CATEGORIES,
} from "@weaver/core";
import { sendKeys, killPane } from "@weaver/tmux";
import { requireProject, type Context } from "./context.ts";
import { spawnWorker } from "./spawn.ts";

// ---- input schemas ----

export const CurrentProjectInput = z.object({});
export const ListProjectsInput = z.object({});
export const NewProjectInput = z.object({
  name: z.string().optional(),
  linear_ticket: z.string().optional(),
});
export const RegisterRepoInput = z.object({
  name: z.string().describe("Short id, e.g. 'chain5'."),
  path: z.string().describe("Absolute path to the repo root."),
  role: z.string().optional().describe("Optional tag: 'backend', 'frontend', ..."),
});
export const CreateWorktreeInput = z.object({
  repo_name: z.string().describe("A repo registered in this workspace's config."),
  branch: z.string(),
  base_branch: z.string().optional().describe("Used when `branch` does not yet exist (default 'main')."),
  linear_ticket: z.string().optional().describe("Appended to the worktree name."),
});
export const ListWorktreesInput = z.object({});
export const RemoveWorktreeInput = z.object({
  worktree_name: z.string(),
});
export const SpawnPaneInput = z.object({
  worktree_name: z.string().describe("Name of a worktree on the current project."),
  task: z.string(),
  model: z.string().optional(),
});
export const ListPanesInput = z.object({
  project_id: z.string().optional(),
  worktree_name: z.string().optional(),
});
export const GetPaneOutputInput = z.object({
  pane_id: z.string(),
  from_start: z.boolean().optional(),
  max_events: z.number().int().positive().optional(),
});
export const SendToPaneInput = z.object({ pane_id: z.string(), text: z.string() });
export const KillPaneInput = z.object({ pane_id: z.string() });
export const PaneSummaryInput = z.object({ pane_id: z.string() });
export const WaitForUpdatesInput = z.object({
  timeout_seconds: z.number().int().min(0).max(120).optional(),
  current_project_only: z
    .boolean()
    .optional()
    .describe("Default true — only watch panes in the current project."),
});

// ---- handlers ----

export async function currentProject(ctx: Context, _in: z.infer<typeof CurrentProjectInput>) {
  if (!ctx.workspace) return { workspace: null, project: null };
  return {
    workspace: { root: ctx.workspace.root, repos: Object.values(ctx.workspace.config.repos) },
    project: ctx.project
      ? {
          id: ctx.project.id,
          name: ctx.project.name,
          linear_ticket: ctx.project.linearTicket,
          worktrees: Object.values(ctx.project.worktrees),
        }
      : null,
  };
}

export async function listProjectsTool(ctx: Context, _in: z.infer<typeof ListProjectsInput>) {
  if (!ctx.workspace) return { projects: [] };
  const projects = await listProjects(ctx.workspace);
  return {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      linear_ticket: p.linearTicket,
      worktrees_count: Object.keys(p.worktrees).length,
      created_at: p.createdAt,
    })),
  };
}

export async function newProject(ctx: Context, input: z.infer<typeof NewProjectInput>) {
  if (!ctx.workspace) throw new Error("no workspace — run `weave workspace init` in your code dir");
  const p = await createProject(ctx.workspace, { name: input.name, linearTicket: input.linear_ticket });
  return {
    id: p.id,
    name: p.name,
    linear_ticket: p.linearTicket,
    created_at: p.createdAt,
    note: "Created. Attach the planner by running `weave up --project " + p.id + "` in a terminal.",
  };
}

export async function registerRepo(ctx: Context, input: z.infer<typeof RegisterRepoInput>) {
  if (!ctx.workspace) throw new Error("no workspace — run `weave workspace init`");
  await addRepo(ctx.workspace, { name: input.name, path: resolve(input.path), role: input.role });
  return { ok: true, repo: { name: input.name, path: resolve(input.path), role: input.role } };
}

export async function createWorktreeTool(ctx: Context, input: z.infer<typeof CreateWorktreeInput>) {
  const { workspace, project } = requireProject(ctx);
  const wt = await addWorktree(workspace, project, {
    repoName: input.repo_name,
    branch: input.branch,
    baseBranch: input.base_branch,
    linearTicket: input.linear_ticket,
  });
  return {
    name: wt.name,
    path: wt.path,
    repo_name: wt.repoName,
    branch: wt.branch,
    linear_ticket: wt.linearTicket,
    tmux_session: wt.tmuxSession,
  };
}

export async function listWorktrees(ctx: Context, _in: z.infer<typeof ListWorktreesInput>) {
  const { project } = requireProject(ctx);
  return { worktrees: Object.values(project.worktrees) };
}

export async function removeWorktreeTool(ctx: Context, input: z.infer<typeof RemoveWorktreeInput>) {
  const { workspace, project } = requireProject(ctx);
  await removeWorktree(workspace, project, input.worktree_name);
  return { ok: true, removed: input.worktree_name };
}

export async function spawnPane(ctx: Context, input: z.infer<typeof SpawnPaneInput>) {
  const { workspace, project } = requireProject(ctx);
  const wt = project.worktrees[input.worktree_name];
  if (!wt) throw new Error(`unknown worktree: ${input.worktree_name}. Call create_worktree first or list_worktrees to see options.`);
  const record = await spawnWorker({ workspace, project, worktree: wt, task: input.task, model: input.model });
  return {
    pane_id: record.id,
    project_id: record.projectId,
    worktree_name: record.worktreeName,
    task: record.task,
    run_file: record.runFile,
    status: record.status,
    created_at: record.createdAt,
  };
}

export async function listPanesTool(ctx: Context, input: z.infer<typeof ListPanesInput>) {
  const records = await listPaneRecords({
    workspaceRoot: ctx.workspace?.root,
    projectId: input.project_id ?? ctx.project?.id,
    worktreeName: input.worktree_name,
  });
  const result = await Promise.all(
    records.map(async (r) => {
      const s = await paneSummary(r.id);
      return {
        pane_id: r.id,
        project_id: r.projectId,
        worktree_name: r.worktreeName,
        task: r.task,
        status: s.status,
        turns: s.turns,
        total_tokens: s.totalTokens,
        error_count: s.errorCount,
        last_command: s.lastCommand,
        last_file_changed: s.lastFileChanged,
        last_message: s.lastMessage,
        last_reviewed_byte: r.lastReviewedByte,
        updated_at: r.updatedAt,
      };
    }),
  );
  return { panes: result };
}

export async function getPaneOutput(_ctx: Context, input: z.infer<typeof GetPaneOutputInput>) {
  const record = await getPaneRecord(input.pane_id);
  if (!record) throw new Error(`pane ${input.pane_id} not found`);
  const sinceByte = input.from_start ? 0 : record.lastReviewedByte;
  const result = await readEvents(input.pane_id, { sinceByte, maxEvents: input.max_events });
  if (!input.from_start && result.endByte > record.lastReviewedByte) {
    await setLastReviewedByte(input.pane_id, result.endByte);
  }
  return {
    pane_id: input.pane_id,
    project_id: record.projectId,
    worktree_name: record.worktreeName,
    events: result.events,
    end_byte: result.endByte,
    file_missing: result.fileMissing,
  };
}

export async function sendToPane(_ctx: Context, input: z.infer<typeof SendToPaneInput>) {
  await sendKeys(input.pane_id, input.text);
  return { ok: true, pane_id: input.pane_id };
}

export async function killPaneTool(_ctx: Context, input: z.infer<typeof KillPaneInput>) {
  await killPane(input.pane_id);
  await removePaneRecord(input.pane_id);
  return { ok: true, pane_id: input.pane_id };
}

export async function paneSummaryTool(_ctx: Context, input: z.infer<typeof PaneSummaryInput>) {
  const record = await getPaneRecord(input.pane_id);
  if (!record) throw new Error(`pane ${input.pane_id} not found`);
  const summary = await paneSummary(input.pane_id);
  return { pane_id: input.pane_id, task: record.task, ...summary };
}

export async function waitForUpdatesTool(ctx: Context, input: z.infer<typeof WaitForUpdatesInput>) {
  const scoped = input.current_project_only !== false; // default true
  const updates = await waitForUpdates({
    timeoutSeconds: input.timeout_seconds ?? 30,
    filter: scoped
      ? { workspaceRoot: ctx.workspace?.root, projectId: ctx.project?.id }
      : undefined,
  });
  return { any_updates: updates.length > 0, updates };
}

// Re-export findWorkspace so callers of context.ts can rehydrate, for symmetry.
export { findWorkspace };

// ---------- Memory ----------

export const ListMemoriesInput = z.object({
  category: z.enum(CATEGORIES as unknown as [string, ...string[]]).optional(),
  tag: z.string().optional(),
});

export const ReadMemoryInput = z.object({
  path: z.string().describe("Path relative to ~/.weave/memory/, e.g. 'architecture/service-boundaries.md'."),
});

export const SearchMemoriesInput = z.object({
  query: z.string(),
  category: z.enum(CATEGORIES as unknown as [string, ...string[]]).optional(),
});

export const RecentMemoriesInput = z.object({
  limit: z.number().int().positive().max(50).optional(),
  category: z.enum(CATEGORIES as unknown as [string, ...string[]]).optional(),
});

export const RememberInput = z.object({
  category: z
    .enum(CATEGORIES as unknown as [string, ...string[]])
    .describe("Which folder the memory goes in. Pick the most specific fit."),
  title: z.string().min(1).describe("Short claim-style title. Becomes the filename (slugified)."),
  body: z.string().min(1).describe("Markdown. Prefer: 1) the rule itself, 2) why, 3) when to apply."),
  tags: z.array(z.string()).optional(),
  status: z.enum(["draft", "canonical", "deprecated"]).optional(),
});

export const ForgetInput = z.object({ path: z.string() });

export async function listMemoriesTool(_ctx: Context, input: z.infer<typeof ListMemoriesInput>) {
  const items = await listMemories({ category: input.category, tag: input.tag });
  return {
    memories: items.map((m) => ({
      path: m.path,
      title: m.frontmatter.title,
      category: m.frontmatter.category,
      tags: m.frontmatter.tags,
      status: m.frontmatter.status,
      updated: m.frontmatter.updated,
    })),
  };
}

export async function readMemoryTool(_ctx: Context, input: z.infer<typeof ReadMemoryInput>) {
  const m = await readMemory(input.path);
  if (!m) throw new Error(`memory not found: ${input.path}`);
  return { path: m.path, frontmatter: m.frontmatter, body: m.body };
}

export async function searchMemoriesTool(_ctx: Context, input: z.infer<typeof SearchMemoriesInput>) {
  const hits = await searchMemories(input.query, { category: input.category });
  return { query: input.query, hits };
}

export async function recentMemoriesTool(_ctx: Context, input: z.infer<typeof RecentMemoriesInput>) {
  const items = await recentMemories({ limit: input.limit, category: input.category });
  return {
    memories: items.map((m) => ({
      path: m.path,
      title: m.frontmatter.title,
      category: m.frontmatter.category,
      tags: m.frontmatter.tags,
      status: m.frontmatter.status,
      updated: m.frontmatter.updated,
    })),
  };
}

export async function rememberTool(_ctx: Context, input: z.infer<typeof RememberInput>) {
  const m = await remember(input);
  return {
    ok: true,
    path: m.path,
    title: m.frontmatter.title,
    category: m.frontmatter.category,
    status: m.frontmatter.status,
    note: `Saved to ~/.weave/memory/${m.path}. Future planners will see it via list/search/read.`,
  };
}

export async function forgetTool(_ctx: Context, input: z.infer<typeof ForgetInput>) {
  const ok = await forget(input.path);
  return { ok, path: input.path };
}
