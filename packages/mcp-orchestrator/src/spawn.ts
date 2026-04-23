// Spawn a Codex worker into a new tmux pane and pipe its JSONL output to
// .weave/runs/<pane>.jsonl. Called by the `spawn_pane` MCP tool.

import { splitPane, sendKeys, pipePane, newSession, hasSession } from "@weaver/tmux";
import { paths, upsertPaneRecord, type PaneRecord, readConfig } from "@weaver/core";

export type SpawnOptions = {
  projectRoot: string;
  task: string;
  model?: string;
};

export async function spawnWorker(opts: SpawnOptions): Promise<PaneRecord> {
  const config = await readConfig(opts.projectRoot);
  if (!config) throw new Error(`${opts.projectRoot} is not a weaver project — run \`weave init\` first`);

  // Ensure the tmux session exists.
  if (!(await hasSession(config.tmuxSession))) {
    await newSession({ name: config.tmuxSession, cwd: opts.projectRoot });
  }

  // Split the last pane of the session to create a new worker pane.
  const paneId = await splitPane({
    target: config.tmuxSession,
    direction: "vertical",
    cwd: opts.projectRoot,
  });

  // Begin teeing pane output to the run file BEFORE sending any input.
  const runFile = paths(opts.projectRoot).runFile(paneId);
  await pipePane(paneId, runFile);

  // Launch Codex in non-interactive JSON mode.
  const codexCmd = buildCodexCommand(opts.task, opts.model);
  await sendKeys(paneId, codexCmd);

  const now = new Date().toISOString();
  const record: PaneRecord = {
    id: paneId,
    task: opts.task,
    model: opts.model,
    status: "running",
    tmuxSession: config.tmuxSession,
    tmuxPane: paneId,
    runFile,
    createdAt: now,
    updatedAt: now,
  };
  await upsertPaneRecord(opts.projectRoot, record);
  return record;
}

function buildCodexCommand(task: string, model?: string): string {
  const modelFlag = model ? ` --model ${shellQuote(model)}` : "";
  return `codex exec --json${modelFlag} ${shellQuote(task)}`;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
