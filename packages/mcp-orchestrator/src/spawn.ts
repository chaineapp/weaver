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
  opts: { binary?: string; model?: string; bypass?: boolean; extraArgs?: string; interactive?: boolean } = {},
): string {
  // Three known binaries get the right flags out of the box; anything else
  // is invoked bare and the user supplies flags via extraArgs.
  //
  // Interactive mode (default) launches the binary's real TUI in the worker
  // pane so the user can watch thoughts, tool calls, and edits the way they
  // would running it directly:
  //
  //   codex    → `codex --no-alt-screen [--full-auto | --dangerously-bypass-...] <task>`
  //              --no-alt-screen keeps everything inline with tmux scrollback.
  //              --full-auto = sandboxed auto-approve (default safe path).
  //              --dangerously-bypass-... = full unsandboxed bypass (when bypass=true).
  //   claude   → `claude --dangerously-skip-permissions <task>` (interactive TUI).
  //
  // Non-interactive mode (interactive=false) keeps the old structured-output
  // path for tooling that needs JSONL (e.g. eval framework):
  //
  //   codex    → `codex exec --json --skip-git-repo-check ...`
  //   claude   → `claude -p --output-format stream-json --verbose ...`
  const binary = opts.binary || "codex";
  const interactive = opts.interactive ?? true;
  let parts: string[];
  if (binary === "codex") {
    if (interactive) {
      // codex auto-detects the cwd as the project; --skip-git-repo-check
      // covers the case where cwd isn't a git repo (Weaver project dirs
      // under .weaver/projects/<id>/).
      parts = ["codex", "--no-alt-screen", "--skip-git-repo-check"];
      if (opts.bypass) {
        parts.push("--dangerously-bypass-approvals-and-sandbox");
      } else {
        parts.push("--full-auto");
      }
    } else {
      parts = ["codex", "exec", "--json", "--skip-git-repo-check"];
      if (opts.bypass) parts.push("--dangerously-bypass-approvals-and-sandbox");
    }
    if (opts.model) parts.push("--model", shellQuote(opts.model));
  } else if (binary === "claude") {
    if (interactive) {
      parts = ["claude"];
      if (opts.bypass) parts.push("--dangerously-skip-permissions");
    } else {
      parts = ["claude", "-p", "--output-format", "stream-json", "--verbose"];
      if (opts.bypass) parts.push("--dangerously-skip-permissions");
    }
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
