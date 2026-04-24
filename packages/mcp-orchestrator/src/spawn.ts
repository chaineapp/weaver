import { splitPane, sendKeys, pipePane, newSession, hasSession } from "@weaver/tmux";
import { weavePaths, upsertPaneRecord, readConfig, type PaneRecord, type WorktreeRecord, type ProjectRecord, type Workspace } from "@weaver/core";

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

  // Resolve worker defaults from ~/.weave/config.json. spawn_pane's model arg
  // overrides config; bypass + extraArgs come from config unconditionally.
  const cfg = await readConfig();
  const model = opts.model ?? cfg?.worker?.model;
  const bypass = cfg?.worker?.bypass ?? false;
  const extraArgs = cfg?.worker?.extraArgs;
  await sendKeys(paneId, buildCodexCommand(opts.task, { model, bypass, extraArgs }));

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

export function buildCodexCommand(
  task: string,
  opts: { model?: string; bypass?: boolean; extraArgs?: string } = {},
): string {
  const parts = ["codex", "exec", "--json"];
  if (opts.bypass) parts.push("--dangerously-bypass-approvals-and-sandbox");
  if (opts.model) parts.push("--model", shellQuote(opts.model));
  if (opts.extraArgs) parts.push(opts.extraArgs);
  parts.push(shellQuote(task));
  return parts.join(" ");
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
