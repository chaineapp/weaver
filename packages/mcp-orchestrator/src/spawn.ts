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
  // overrides config; binary + bypass + extraArgs come from config.
  const cfg = await readConfig();
  await sendKeys(
    paneId,
    buildCodexCommand(opts.task, {
      binary: cfg?.worker?.binary,
      model: opts.model ?? cfg?.worker?.model,
      bypass: cfg?.worker?.bypass ?? false,
      extraArgs: cfg?.worker?.extraArgs,
    }),
  );

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
  opts: { binary?: string; model?: string; bypass?: boolean; extraArgs?: string } = {},
): string {
  // Worker defaults to `codex exec --json`. If the user set worker.binary to
  // something custom (aider, etc.), they own the invocation flags — we only
  // pass the task and their extraArgs.
  const binary = opts.binary || "codex";
  const parts: string[] = binary === "codex" ? ["codex", "exec", "--json"] : [binary];
  if (opts.bypass && binary === "codex") parts.push("--dangerously-bypass-approvals-and-sandbox");
  if (opts.model) parts.push("--model", shellQuote(opts.model));
  if (opts.extraArgs) parts.push(opts.extraArgs);
  parts.push(shellQuote(task));
  return parts.join(" ");
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
