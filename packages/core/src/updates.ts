import { listPaneRecords, type PaneRecord } from "./panes.ts";
import { runFileSize } from "./runs.ts";

export type PaneUpdate = {
  pane_id: string;
  workspace_root: string;
  project_id: string;
  worktree_name: string;
  task: string;
  new_bytes: number;
  current_size: number;
  reviewed_byte: number;
};

export type WaitOptions = {
  timeoutSeconds?: number;
  pollMs?: number;
  filter?: { workspaceRoot?: string; projectId?: string; worktreeName?: string };
};

export async function waitForUpdates(opts: WaitOptions = {}): Promise<PaneUpdate[]> {
  const timeoutMs = (opts.timeoutSeconds ?? 30) * 1000;
  const pollMs = opts.pollMs ?? 300;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const updates = await collectUpdates(opts.filter);
    if (updates.length > 0) return updates;
    if (Date.now() >= deadline) return [];
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function collectUpdates(filter?: WaitOptions["filter"]): Promise<PaneUpdate[]> {
  const panes = await listPaneRecords(filter);
  const out: PaneUpdate[] = [];
  for (const p of panes) {
    const size = await runFileSize(p.id);
    if (size > p.lastReviewedByte) out.push(toUpdate(p, size));
  }
  return out;
}

function toUpdate(p: PaneRecord, size: number): PaneUpdate {
  return {
    pane_id: p.id,
    workspace_root: p.workspaceRoot,
    project_id: p.projectId,
    worktree_name: p.worktreeName,
    task: p.task,
    new_bytes: size - p.lastReviewedByte,
    current_size: size,
    reviewed_byte: p.lastReviewedByte,
  };
}
