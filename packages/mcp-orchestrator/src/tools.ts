import { z } from "zod";
import {
  listPaneRecords,
  getPaneRecord,
  removePaneRecord,
  readEvents,
  paneSummary,
} from "@weaver/core";
import { sendKeys, killPane } from "@weaver/tmux";
import { spawnWorker } from "./spawn.ts";

// Schemas for tool inputs — these are what the planner Claude passes us.

export const SpawnPaneInput = z.object({
  task: z.string().min(1).describe("The task for the Codex worker to execute. A one-line prompt."),
  model: z.string().optional().describe("Optional Codex model override (e.g. 'gpt-5-codex')."),
});

export const ListPanesInput = z.object({});

export const GetPaneOutputInput = z.object({
  pane_id: z.string().describe("The pane id returned by spawn_pane, e.g. '%5'."),
  since_byte: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("For incremental reads: the endByte from a previous call. Omit to read from start."),
  max_events: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Cap on number of events returned (returns the last N)."),
});

export const SendToPaneInput = z.object({
  pane_id: z.string().describe("The pane id to send input to."),
  text: z.string().describe("Text to inject. A newline (Enter) is automatically sent after."),
});

export const KillPaneInput = z.object({
  pane_id: z.string().describe("The pane id to terminate."),
});

export const PaneSummaryInput = z.object({
  pane_id: z.string().describe("The pane id to summarize."),
});

// Tool implementations — each returns a plain object that we JSON-serialize
// as the MCP tool result.

export async function spawnPane(projectRoot: string, input: z.infer<typeof SpawnPaneInput>) {
  const record = await spawnWorker({
    projectRoot,
    task: input.task,
    model: input.model,
  });
  return {
    pane_id: record.id,
    task: record.task,
    run_file: record.runFile,
    status: record.status,
    created_at: record.createdAt,
  };
}

export async function listPanes(projectRoot: string, _input: z.infer<typeof ListPanesInput>) {
  const records = await listPaneRecords(projectRoot);
  const result = await Promise.all(
    records.map(async (r) => {
      const summary = await paneSummary(projectRoot, r.id);
      return {
        pane_id: r.id,
        task: r.task,
        status: summary.status,
        turns: summary.turns,
        error_count: summary.errorCount,
        total_tokens: summary.totalTokens,
        last_command: summary.lastCommand,
        last_file_changed: summary.lastFileChanged,
        last_message: summary.lastMessage,
        updated_at: r.updatedAt,
      };
    }),
  );
  return { panes: result };
}

export async function getPaneOutput(
  projectRoot: string,
  input: z.infer<typeof GetPaneOutputInput>,
) {
  const record = await getPaneRecord(projectRoot, input.pane_id);
  if (!record) throw new Error(`pane ${input.pane_id} not found`);
  const result = await readEvents(projectRoot, input.pane_id, {
    sinceByte: input.since_byte,
    maxEvents: input.max_events,
  });
  return {
    pane_id: input.pane_id,
    events: result.events,
    end_byte: result.endByte,
    file_missing: result.fileMissing,
  };
}

export async function sendToPane(_projectRoot: string, input: z.infer<typeof SendToPaneInput>) {
  await sendKeys(input.pane_id, input.text);
  return { ok: true, pane_id: input.pane_id };
}

export async function killPaneTool(projectRoot: string, input: z.infer<typeof KillPaneInput>) {
  await killPane(input.pane_id);
  await removePaneRecord(projectRoot, input.pane_id);
  return { ok: true, pane_id: input.pane_id };
}

export async function paneSummaryTool(
  projectRoot: string,
  input: z.infer<typeof PaneSummaryInput>,
) {
  const record = await getPaneRecord(projectRoot, input.pane_id);
  if (!record) throw new Error(`pane ${input.pane_id} not found`);
  const summary = await paneSummary(projectRoot, input.pane_id);
  return { pane_id: input.pane_id, task: record.task, ...summary };
}
