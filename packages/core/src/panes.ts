import { weavePaths } from "./paths.ts";

// Global pane registry. Panes are now tagged with (workspaceRoot, projectId,
// worktreeName) so a single view aggregates everything across workspaces.

export type PaneStatus = "idle" | "running" | "completed" | "failed";

export type PaneRecord = {
  id: string;
  workspaceRoot: string;
  projectId: string;
  worktreeName: string;
  task: string;
  model?: string;
  status: PaneStatus;
  tmuxSession: string;
  runFile: string;
  lastReviewedByte: number;
  // workerNum is 1..N for panes created by `weave up`'s buildPlannerLayout.
  // Lets the user reference workers by `worker-1` instead of tmux pane id `%23`.
  // Optional because on-demand spawn_pane workers (no fixed slot) may omit it.
  workerNum?: number;
  // binary the worker will run when dispatched (codex / claude / aider / ...).
  // Set at registration time from project plannerBinary config or global default.
  binary?: string;
  createdAt: string;
  updatedAt: string;
};

type PanesFile = {
  version: 2;
  panes: Record<string, PaneRecord>;
};

async function load(): Promise<PanesFile> {
  const file = Bun.file(weavePaths().panes);
  if (!(await file.exists())) return { version: 2, panes: {} };
  const data = (await file.json()) as { version?: number; panes?: Record<string, unknown> };
  // Ignore v1 panes — they predate the workspace/project model.
  if (data.version !== 2) return { version: 2, panes: {} };
  return data as PanesFile;
}

async function save(data: PanesFile): Promise<void> {
  await Bun.write(weavePaths().panes, JSON.stringify(data, null, 2) + "\n");
}

export async function listPaneRecords(filter?: {
  workspaceRoot?: string;
  projectId?: string;
  worktreeName?: string;
}): Promise<PaneRecord[]> {
  const data = await load();
  let rows = Object.values(data.panes);
  if (filter?.workspaceRoot) rows = rows.filter((r) => r.workspaceRoot === filter.workspaceRoot);
  if (filter?.projectId) rows = rows.filter((r) => r.projectId === filter.projectId);
  if (filter?.worktreeName) rows = rows.filter((r) => r.worktreeName === filter.worktreeName);
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
