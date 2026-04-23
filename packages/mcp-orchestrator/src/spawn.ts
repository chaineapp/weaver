import { splitPane, sendKeys, pipePane, newSession, hasSession } from "@weaver/tmux";
import {
  weavePaths,
  upsertPaneRecord,
  resolveOrRegister,
  type PaneRecord,
} from "@weaver/core";

export type SpawnOptions = {
  task: string;
  cwd: string;              // working directory the worker runs in (a project root or worktree)
  model?: string;
};

export async function spawnWorker(opts: SpawnOptions): Promise<PaneRecord> {
  const { project, worktree } = await resolveOrRegister(opts.cwd);

  if (!(await hasSession(worktree.tmuxSession))) {
    await newSession({ name: worktree.tmuxSession, cwd: worktree.path });
  }

  const paneId = await splitPane({
    target: worktree.tmuxSession,
    direction: "vertical",
    cwd: worktree.path,
  });

  const runFile = weavePaths().runFile(paneId);
  await pipePane(paneId, runFile);

  await sendKeys(paneId, buildCodexCommand(opts.task, opts.model));

  const now = new Date().toISOString();
  const record: PaneRecord = {
    id: paneId,
    projectId: project.id,
    worktreeId: worktree.id,
    task: opts.task,
    model: opts.model,
    status: "running",
    tmuxSession: worktree.tmuxSession,
    runFile,
    lastReviewedByte: 0,
    createdAt: now,
    updatedAt: now,
  };
  await upsertPaneRecord(record);
  return record;
}

function buildCodexCommand(task: string, model?: string): string {
  const modelFlag = model ? ` --model ${shellQuote(model)}` : "";
  return `codex exec --json${modelFlag} ${shellQuote(task)}`;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
