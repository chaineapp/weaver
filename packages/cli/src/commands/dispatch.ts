import { findWorkspace, listPaneRecords, getPaneRecord, setPaneStatus, readConfig } from "@weaver/core";
import { sendKeys } from "@weaver/tmux";
import { buildCodexCommand } from "@weaver/mcp-orchestrator";

// `weave dispatch <worker> <task>` — assigns a task to a registered worker
// pane. Resolves <worker> in three ways:
//   - "worker-N" — matches pane.workerNum within the current workspace
//   - "%23"      — direct tmux pane id
//   - "<paneid>" — same
//
// On dispatch:
//   1. (optional) `cd <opts.cwd>` in the pane so the worker's claude/codex
//       picks up that path as its primary directory — needed when the work is
//       in a worktree separate from where `weave up` was run, otherwise
//       claude's Edit tool refuses to write outside its launch cwd.
//   2. Build the worker command (codex by default; --binary overrides per call)
//   3. tmux send-keys → the pane runs `codex exec --json '<task>'` (or whatever)
//   4. Set pane status to "running"
//
// The worker's output streams to ~/.weave/runs/<paneid>.jsonl via the
// `pipe-pane` set up at `weave up` time. The user (or planner) follows up with
// `weave tail <worker> --wait-done` to get the final result.
//
// This is the Bash-driven path that bypasses MCP — see CHA-1012. When that
// upstream bug is fixed, MCP's send_to_pane becomes the nicer surface; this
// CLI keeps working regardless.

export type DispatchOpts = {
  worker: string;
  task: string;
  binary?: string;   // override worker.binary just for this dispatch
  model?: string;    // override worker.model just for this dispatch
  bypass?: boolean;
  cwd?: string;      // cd the worker pane here before running the task
};

export async function runDispatch(opts: DispatchOpts): Promise<void> {
  if (!opts.worker || !opts.task) {
    console.error("usage: weave dispatch <worker-N | %paneid> <task>");
    process.exit(1);
  }

  const ws = await findWorkspace();
  if (!ws) {
    console.error("not inside a Weaver workspace — run `weave workspace init` first");
    process.exit(1);
  }

  const pane = await resolveWorker(opts.worker, ws.root);
  if (!pane) {
    const all = await listPaneRecords({ workspaceRoot: ws.root });
    console.error(`no worker matches "${opts.worker}".`);
    if (all.length === 0) {
      console.error(`  no panes registered. Run \`weave up --panes N\` first.`);
    } else {
      console.error(`  registered panes:`);
      for (const p of all) {
        const slot = p.workerNum != null ? `worker-${p.workerNum}` : "(unnumbered)";
        console.error(`    ${slot}  ${p.id}  status=${p.status}  project=${p.projectId}`);
      }
    }
    process.exit(1);
  }

  // Build the codex (or whatever binary) command. Prefer per-dispatch binary,
  // then the one stored on the pane at registration, then config, then codex.
  const cfg = await readConfig();
  const binary = opts.binary ?? pane.binary ?? cfg?.worker?.binary ?? "codex";
  const cmd = buildCodexCommand(opts.task, {
    binary,
    model: opts.model ?? cfg?.worker?.model,
    bypass: opts.bypass ?? cfg?.worker?.bypass ?? false,
    extraArgs: cfg?.worker?.extraArgs,
  });

  // If the planner asked for a specific cwd (e.g. a fresh worktree), cd the
  // pane there first. claude treats its launch cwd as the "primary directory"
  // for Edit-tool sandboxing, so without this the worker can't write to a
  // different path than wherever `weave up` started the pane (typically the
  // project folder). Sleep a beat after cd so the prompt redraws before we
  // type the next command — without it the keystrokes can race the redraw and
  // get interpreted as part of the prompt.
  if (opts.cwd) {
    await sendKeys(pane.id, `cd ${shellQuote(opts.cwd)}`, true);
    await new Promise((r) => setTimeout(r, 150));
  }

  await sendKeys(pane.id, cmd, true);
  await setPaneStatus(pane.id, "running");

  const slot = pane.workerNum != null ? `worker-${pane.workerNum}` : pane.id;
  console.log(`✓ dispatched to ${slot} (${pane.id}, ${binary}${opts.cwd ? `, cwd=${opts.cwd}` : ""})`);
  console.log(`  task: ${opts.task}`);
  console.log(`  follow output: weave tail ${slot} --follow`);
  console.log(`  wait until done: weave tail ${slot} --wait-done`);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

async function resolveWorker(token: string, workspaceRoot: string) {
  // 1. Direct pane id (`%23`).
  if (token.startsWith("%")) return await getPaneRecord(token);

  // 2. `worker-N` form.
  const m = token.match(/^worker-(\d+)$/);
  if (m) {
    const want = parseInt(m[1]!, 10);
    // Prefer the planner's own env-set project id (set on the tmux session by
    // `weave up`). Falls back to workspaceRoot filter, then to ALL panes.
    // The "ALL" fallback handles macOS /tmp ↔ /private/tmp symlink mismatches
    // where findWorkspace canonicalizes one way and registry stored the other.
    const projectId = process.env.WEAVER_PROJECT_ID;
    if (projectId) {
      const byProject = await listPaneRecords({ projectId });
      const m1 = byProject.find((p) => p.workerNum === want);
      if (m1) return m1;
    }
    const byWs = await listPaneRecords({ workspaceRoot });
    const m2 = byWs.find((p) => p.workerNum === want);
    if (m2) return m2;
    const any = await listPaneRecords();
    return any.find((p) => p.workerNum === want) ?? null;
  }

  // 3. Bare pane id without `%` (uncommon but accept).
  const direct = await getPaneRecord(token);
  if (direct) return direct;
  const withPct = await getPaneRecord(`%${token}`);
  return withPct ?? null;
}
