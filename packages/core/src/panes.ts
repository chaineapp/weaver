import { paths } from "./paths.ts";

// v1: simple JSON registry, one object per pane, flushed on every mutation.
// Concurrency: single writer (the currently-running weave / weave mcp process).
// When we add the daemon (v1.1), this moves to SQLite with proper locking.

export type PaneStatus = "idle" | "running" | "completed" | "failed";

export type PaneRecord = {
  id: string; // tmux pane id, e.g. "%5"
  task: string;
  model?: string;
  status: PaneStatus;
  tmuxSession: string;
  tmuxPane: string; // same as id, kept explicit for clarity
  runFile: string;
  createdAt: string;
  updatedAt: string;
};

type PanesFile = {
  version: 1;
  panes: Record<string, PaneRecord>;
};

async function load(projectRoot: string): Promise<PanesFile> {
  const file = Bun.file(paths(projectRoot).panes);
  if (!(await file.exists())) return { version: 1, panes: {} };
  return (await file.json()) as PanesFile;
}

async function save(projectRoot: string, data: PanesFile): Promise<void> {
  await Bun.write(paths(projectRoot).panes, JSON.stringify(data, null, 2) + "\n");
}

export async function listPaneRecords(projectRoot: string): Promise<PaneRecord[]> {
  const data = await load(projectRoot);
  return Object.values(data.panes);
}

export async function getPaneRecord(projectRoot: string, id: string): Promise<PaneRecord | null> {
  const data = await load(projectRoot);
  return data.panes[id] ?? null;
}

export async function upsertPaneRecord(projectRoot: string, record: PaneRecord): Promise<void> {
  const data = await load(projectRoot);
  data.panes[record.id] = record;
  await save(projectRoot, data);
}

export async function setPaneStatus(
  projectRoot: string,
  id: string,
  status: PaneStatus,
): Promise<void> {
  const data = await load(projectRoot);
  const current = data.panes[id];
  if (!current) return;
  current.status = status;
  current.updatedAt = new Date().toISOString();
  data.panes[id] = current;
  await save(projectRoot, data);
}

export async function removePaneRecord(projectRoot: string, id: string): Promise<void> {
  const data = await load(projectRoot);
  delete data.panes[id];
  await save(projectRoot, data);
}
