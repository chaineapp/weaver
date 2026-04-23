import { weavePaths } from "./paths.ts";

// Global pane registry: one row per Codex worker, keyed by tmux pane id.
// Each pane belongs to a (projectId, worktreeId) pair. The `lastReviewedByte`
// cursor is the planner's bookmark into the run file — `get_pane_output` reads
// from here and advances it so follow-up calls return only new events.

export type PaneStatus = "idle" | "running" | "completed" | "failed";

export type PaneRecord = {
  id: string;                   // tmux pane id, e.g. "%5"
  projectId: string;
  worktreeId: string;
  task: string;
  model?: string;
  status: PaneStatus;
  tmuxSession: string;
  runFile: string;
  lastReviewedByte: number;     // planner's read cursor into runFile
  createdAt: string;
  updatedAt: string;
};

type PanesFile = {
  version: 1;
  panes: Record<string, PaneRecord>;
};

async function load(): Promise<PanesFile> {
  const file = Bun.file(weavePaths().panes);
  if (!(await file.exists())) return { version: 1, panes: {} };
  return (await file.json()) as PanesFile;
}

async function save(data: PanesFile): Promise<void> {
  await Bun.write(weavePaths().panes, JSON.stringify(data, null, 2) + "\n");
}

export async function listPaneRecords(filter?: { projectId?: string; worktreeId?: string }): Promise<PaneRecord[]> {
  const data = await load();
  let rows = Object.values(data.panes);
  if (filter?.projectId) rows = rows.filter((r) => r.projectId === filter.projectId);
  if (filter?.worktreeId) rows = rows.filter((r) => r.worktreeId === filter.worktreeId);
  return rows;
}

export async function getPaneRecord(id: string): Promise<PaneRecord | null> {
  const data = await load();
  return data.panes[id] ?? null;
}

export async function upsertPaneRecord(record: PaneRecord): Promise<void> {
  const data = await load();
  data.panes[record.id] = record;
  await save(data);
}

export async function setPaneStatus(id: string, status: PaneStatus): Promise<void> {
  const data = await load();
  const current = data.panes[id];
  if (!current) return;
  current.status = status;
  current.updatedAt = new Date().toISOString();
  data.panes[id] = current;
  await save(data);
}

export async function setLastReviewedByte(id: string, byte: number): Promise<void> {
  const data = await load();
  const current = data.panes[id];
  if (!current) return;
  current.lastReviewedByte = byte;
  current.updatedAt = new Date().toISOString();
  data.panes[id] = current;
  await save(data);
}

export async function removePaneRecord(id: string): Promise<void> {
  const data = await load();
  delete data.panes[id];
  await save(data);
}
