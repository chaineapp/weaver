import { weavePaths } from "./paths.ts";

// Global pane registry. Panes are now tagged with (workspaceRoot, projectId,
// worktreeName) so a single view aggregates everything across workspaces.
//
// CONCURRENCY: every mutation goes through `mutate()`, which holds a
// cross-process lock (mkdir-based — POSIX-atomic) around the read-modify-
// write cycle. Without this, parallel `weave dispatch` invocations (e.g. 4
// workers fired in parallel from a planner) clobber each other's writes
// because each one does a separate load/save of panes.json. We saw this
// in production: lastReviewedByte updates got dropped, causing
// `weave tail --wait-done` to read stale events from prior dispatches.

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

// Cross-process lock around panes.json read-modify-write. Implemented as a
// mkdir-spinlock (mkdir is POSIX-atomic — fails if dir already exists).
// 5s timeout / 50ms retry — generous because contention only happens during
// the brief load+save window per mutation.
async function withPanesLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockDir = weavePaths().panes + ".lock";
  const start = Date.now();
  // Stale-lock recovery: if the lock dir is older than 30s, assume the
  // holder crashed without cleaning up and break the lock.
  while (true) {
    const proc = Bun.spawn(["mkdir", lockDir], { stdout: "ignore", stderr: "pipe" });
    const code = await proc.exited;
    if (code === 0) break;
    // Check stale lock age
    try {
      const stat = await Bun.file(lockDir).stat();
      // mtime in ms — Bun returns a Date or number depending on version
      const mtime = typeof stat.mtime === "number" ? stat.mtime : (stat.mtime as Date).getTime();
      if (Date.now() - mtime > 30_000) {
        Bun.spawn(["rmdir", lockDir], { stdout: "ignore", stderr: "ignore" });
      }
    } catch { /* dir may have been deleted between checks — fine */ }
    if (Date.now() - start > 5000) {
      throw new Error(`pane registry lock timeout after 5s (lockDir=${lockDir}). Stale lock? Try: rmdir '${lockDir}'`);
    }
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
  }
  try {
    return await fn();
  } finally {
    Bun.spawn(["rmdir", lockDir], { stdout: "ignore", stderr: "ignore" });
  }
}

// Generic mutate-under-lock helper. Every write path uses this so concurrent
// `weave dispatch` calls (or `weave clean` racing with a dispatch) serialize
// cleanly instead of clobbering each other.
async function mutate(fn: (data: PanesFile) => void): Promise<void> {
  await withPanesLock(async () => {
    const data = await load();
    fn(data);
    await save(data);
  });
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
  await mutate((data) => { data.panes[record.id] = record; });
}

export async function setPaneStatus(id: string, status: PaneStatus): Promise<void> {
  await mutate((data) => {
    const current = data.panes[id];
    if (!current) return;
    current.status = status;
    current.updatedAt = new Date().toISOString();
  });
}

export async function setLastReviewedByte(id: string, byte: number): Promise<void> {
  await mutate((data) => {
    const current = data.panes[id];
    if (!current) return;
    current.lastReviewedByte = byte;
    current.updatedAt = new Date().toISOString();
  });
}

// Atomic "start a dispatch": set lastReviewedByte and flip status to running
// in a single critical section. Replaces the prior pattern of two separate
// setLastReviewedByte + setPaneStatus calls — those two writes were a race
// window where parallel dispatches could clobber the byte update.
export async function beginDispatch(id: string, byte: number): Promise<void> {
  await mutate((data) => {
    const current = data.panes[id];
    if (!current) return;
    current.lastReviewedByte = byte;
    current.status = "running";
    current.updatedAt = new Date().toISOString();
  });
}

export async function removePaneRecord(id: string): Promise<void> {
  await mutate((data) => { delete data.panes[id]; });
}
