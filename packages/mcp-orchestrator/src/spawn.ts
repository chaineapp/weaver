import { splitPane, sendKeys, pipePane, newSession, hasSession } from "@weaver/tmux";
import { weavePaths, upsertPaneRecord, type PaneRecord, type WorktreeRecord, type ProjectRecord, type Workspace } from "@weaver/core";

export type SpawnOptions = {
  workspace: Workspace;
  project: ProjectRecord;
  worktree: WorktreeRecord;
  task: string;
  model?: string;
};

export async function spawnWorker(opts: SpawnOptions): Promise<PaneRecord> {
  const session = opts.worktree.tmuxSession;

  if (!(await hasSession(session))) {
    await newSession({ name: session, cwd: opts.worktree.path });
  }

  const paneId = await splitPane({
    target: session,
    direction: "vertical",
    cwd: opts.worktree.path,
  });

  const runFile = weavePaths().runFile(paneId);
  await pipePane(paneId, runFile);
  await sendKeys(paneId, buildCodexCommand(opts.task, opts.model));

  const now = new Date().toISOString();
  const record: PaneRecord = {
    id: paneId,
    workspaceRoot: opts.workspace.root,
    projectId: opts.project.id,
    worktreeName: opts.worktree.name,
    task: opts.task,
    model: opts.model,
    status: "running",
    tmuxSession: session,
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
