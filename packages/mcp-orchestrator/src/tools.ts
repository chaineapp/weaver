import { z } from "zod";
import { resolve } from "node:path";
import {
  listPaneRecords,
  getPaneRecord,
  removePaneRecord,
  readEvents,
  paneSummary,
  setLastReviewedByte,
  listProjects,
  getProject,
  waitForUpdates,
} from "@weaver/core";
import { sendKeys, killPane } from "@weaver/tmux";
import { spawnWorker } from "./spawn.ts";

// Every tool handler receives `serverCwd` — the cwd the MCP server was launched
// in. This is the planner Claude's cwd. Tools default missing path/project args
// to this location, which is how `spawn_pane({task: "foo"})` Just Works from any
// repo without further configuration.

// ---- input schemas ----

export const SpawnPaneInput = z.object({
  task: z.string().min(1).describe("One-line prompt for the Codex worker."),
  cwd: z
    .string()
    .optional()
    .describe(
      "Absolute path to run the worker in. Defaults to the planner's cwd. Use this to target a specific worktree.",
    ),
  project: z
    .string()
    .optional()
    .describe(
      "Explicit project id. Usually unnecessary — prefer `cwd`. Provided for forcing an unusual project label.",
    ),
  worktree: z
    .string()
    .optional()
    .describe("Explicit worktree id within the specified project."),
  model: z.string().optional().describe("Codex model override."),
});

export const ListPanesInput = z.object({
  project_id: z.string().optional().describe("Filter to one project."),
  worktree_id: z.string().optional().describe("Filter to one worktree within the project."),
});

export const GetPaneOutputInput = z.object({
  pane_id: z.string(),
  from_start: z
    .boolean()
    .optional()
    .describe("Replay from the start of the run file instead of resuming from the review cursor."),
  max_events: z.number().int().positive().optional(),
});

export const SendToPaneInput = z.object({
  pane_id: z.string(),
  text: z.string(),
});

export const KillPaneInput = z.object({
  pane_id: z.string(),
});

export const PaneSummaryInput = z.object({
  pane_id: z.string(),
});

export const ListProjectsInput = z.object({});

export const WaitForUpdatesInput = z.object({
  timeout_seconds: z
    .number()
    .int()
    .min(0)
    .max(120)
    .optional()
    .describe("How long to block (default 30s). 0 means 'poll once and return immediately'."),
  project_id: z.string().optional().describe("Only wait for updates on panes in this project."),
  worktree_id: z.string().optional(),
});

// ---- handlers ----

export async function spawnPane(serverCwd: string, input: z.infer<typeof SpawnPaneInput>) {
  let cwd = input.cwd ? resolve(input.cwd) : serverCwd;
  if (input.project) {
    const proj = await getProject(input.project);
    if (!proj) throw new Error(`unknown project: ${input.project}`);
    const wt = input.worktree ? proj.worktrees[input.worktree] : proj.worktrees["main"];
    if (!wt) throw new Error(`unknown worktree ${input.worktree ?? "main"} in project ${input.project}`);
    cwd = wt.path;
  }
  const record = await spawnWorker({ task: input.task, cwd, model: input.model });
  return {
    pane_id: record.id,
    project_id: record.projectId,
    worktree_id: record.worktreeId,
    task: record.task,
    run_file: record.runFile,
    status: record.status,
    created_at: record.createdAt,
  };
}

export async function listPanesTool(_serverCwd: string, input: z.infer<typeof ListPanesInput>) {
  const records = await listPaneRecords({ projectId: input.project_id, worktreeId: input.worktree_id });
  const result = await Promise.all(
    records.map(async (r) => {
      const s = await paneSummary(r.id);
      return {
        pane_id: r.id,
        project_id: r.projectId,
        worktree_id: r.worktreeId,
        task: r.task,
        status: s.status,
        turns: s.turns,
        error_count: s.errorCount,
        total_tokens: s.totalTokens,
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

export async function getPaneOutput(_serverCwd: string, input: z.infer<typeof GetPaneOutputInput>) {
  const record = await getPaneRecord(input.pane_id);
  if (!record) throw new Error(`pane ${input.pane_id} not found`);
  const sinceByte = input.from_start ? 0 : record.lastReviewedByte;
  const result = await readEvents(input.pane_id, { sinceByte, maxEvents: input.max_events });
  // Auto-advance the review cursor so subsequent calls return only new events.
  if (!input.from_start && result.endByte > record.lastReviewedByte) {
    await setLastReviewedByte(input.pane_id, result.endByte);
  }
  return {
    pane_id: input.pane_id,
    project_id: record.projectId,
    worktree_id: record.worktreeId,
    events: result.events,
    end_byte: result.endByte,
    file_missing: result.fileMissing,
  };
}

export async function sendToPane(_serverCwd: string, input: z.infer<typeof SendToPaneInput>) {
  await sendKeys(input.pane_id, input.text);
  return { ok: true, pane_id: input.pane_id };
}

export async function killPaneTool(_serverCwd: string, input: z.infer<typeof KillPaneInput>) {
  await killPane(input.pane_id);
  await removePaneRecord(input.pane_id);
  return { ok: true, pane_id: input.pane_id };
}

export async function paneSummaryTool(_serverCwd: string, input: z.infer<typeof PaneSummaryInput>) {
  const record = await getPaneRecord(input.pane_id);
  if (!record) throw new Error(`pane ${input.pane_id} not found`);
  const summary = await paneSummary(input.pane_id);
  return { pane_id: input.pane_id, task: record.task, ...summary };
}

export async function listProjectsTool(_serverCwd: string, _input: z.infer<typeof ListProjectsInput>) {
  const projects = await listProjects();
  return {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      root_path: p.rootPath,
      worktrees: Object.values(p.worktrees).map((w) => ({
        id: w.id,
        path: w.path,
        branch: w.branch,
        tmux_session: w.tmuxSession,
      })),
      created_at: p.createdAt,
    })),
  };
}

export async function waitForUpdatesTool(_serverCwd: string, input: z.infer<typeof WaitForUpdatesInput>) {
  const updates = await waitForUpdates({
    timeoutSeconds: input.timeout_seconds ?? 30,
    filter: { projectId: input.project_id, worktreeId: input.worktree_id },
  });
  return { any_updates: updates.length > 0, updates };
}
