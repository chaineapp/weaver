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
  // Three known binaries get the right flags out of the box; anything else
  // is invoked bare and the user supplies flags via extraArgs.
  //
  //   codex    → `codex exec --json` (non-interactive JSONL stream)
  //   claude   → `claude -p`         (non-interactive print mode, similar idea)
  //   <other>  → bare binary, task at the end
  const binary = opts.binary || "codex";
  let parts: string[];
  if (binary === "codex") {
    // --skip-git-repo-check: codex refuses to run in a directory that isn't
    // an explicitly-trusted git repo. Inside Weaver, workers are dispatched
    // by a trusted parent (the planner), and the cwd may be a project folder
    // under .weaver/projects/<id>/ that isn't a git repo at all. Always
    // pass the flag so codex doesn't fail before it starts. Verified
    // necessary: without it, dispatched codex workers exited with
    // "Not inside a trusted directory and --skip-git-repo-check was not
    //  specified".
    parts = ["codex", "exec", "--json", "--skip-git-repo-check"];
    if (opts.bypass) parts.push("--dangerously-bypass-approvals-and-sandbox");
    if (opts.model) parts.push("--model", shellQuote(opts.model));
  } else if (binary === "claude") {
    // claude -p with stream-json output emits proper JSONL we can parse for
    // turn-complete events. Without --output-format stream-json, claude prints
    // plain rendered text and `weave tail --wait-done` has nothing to grab on
    // to. claude requires --verbose when --output-format=stream-json (per
    // claude's own validation). The pipe-paned terminal still captures all of
    // it; tail.ts knows both shapes.
    parts = ["claude", "-p", "--output-format", "stream-json", "--verbose"];
    if (opts.bypass) parts.push("--dangerously-skip-permissions");
    if (opts.model) parts.push("--model", shellQuote(opts.model));
  } else {
    parts = [binary];
    if (opts.model) parts.push("--model", shellQuote(opts.model));
  }
  if (opts.extraArgs) parts.push(opts.extraArgs);
  parts.push(shellQuote(task));
  return parts.join(" ");
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
