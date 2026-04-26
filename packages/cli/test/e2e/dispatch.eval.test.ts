// Eval-style end-to-end tests for the dispatch flow. These spin up REAL
// tmux sessions + REAL claude planners and consume real API tokens, so they
// are gated behind WEAVER_RUN_EVALS=1 (skipped by default).
//
// Run with:
//   WEAVER_RUN_EVALS=1 bun test packages/cli/test/e2e/dispatch.eval.test.ts
//
// Each test:
//   1. Sets up a temp workspace at /tmp/weave-eval-<rand>/
//   2. Creates a project with --planner claude
//   3. Runs `weave up --panes N` with WEAVER_NO_GHOSTTY=1 (no window pops)
//   4. Sends a prompt to the planner via tmux send-keys
//   5. Polls the planner's pane content for an expected result marker
//   6. Asserts + tears down (kill tmux session, rm temp dir)
//
// Skipped tests document the next-phase capability they will exercise once
// the underlying feature ships.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENABLED = process.env.WEAVER_RUN_EVALS === "1";

// Pick a usable planner binary at module load: prefer claude, fall back to
// codex if claude isn't installed/usable, skip the whole suite if neither
// works. Avoids placeholder runs against a binary that will crash on launch.
const PLANNER = await pickPlannerBinary();
const skipIf = ENABLED && PLANNER ? test : test.skip;

async function pickPlannerBinary(): Promise<"claude" | "codex" | null> {
  for (const candidate of ["claude", "codex"] as const) {
    try {
      const proc = Bun.spawn([candidate, "--version"], { stdout: "pipe", stderr: "pipe" });
      const code = await Promise.race([
        proc.exited,
        new Promise<number>((r) => setTimeout(() => { proc.kill(); r(124); }, 5000)),
      ]);
      if (code === 0) return candidate;
    } catch { /* binary not on PATH — try next */ }
  }
  return null;
}

// Per-test cleanup state. Populated by setupEvalProject; consumed by afterEach.
let liveSession: string | null = null;
let liveWorkspace: string | null = null;

afterEach(async () => {
  if (liveSession) {
    Bun.spawn(["tmux", "kill-session", "-t", liveSession], { stdout: "ignore", stderr: "ignore" });
    liveSession = null;
  }
  if (liveWorkspace) {
    await rm(liveWorkspace, { recursive: true, force: true }).catch(() => {});
    liveWorkspace = null;
  }
  // Wipe the global pane registry of records we created (their workspaceRoot
  // points at the temp dir we just deleted). Cheaper than surgical deletion.
  Bun.spawn(["bun", "run", "-e", `
    import { weavePaths } from "./packages/core/src/index.ts";
    await Bun.write(weavePaths().panes, JSON.stringify({ version: 2, panes: {} }, null, 2) + "\\n");
  `], { stdout: "ignore", stderr: "ignore", cwd: process.cwd() });
});

async function setupEvalProject(opts: { name: string; panes: number; planner: string }): Promise<{ session: string; project: string; ws: string }> {
  const wsRoot = await mkdtemp(join(tmpdir(), "weave-eval-"));
  liveWorkspace = wsRoot;

  // Init the workspace via the CLI so we exercise the same paths a real user does.
  await runCli(["workspace", "init", wsRoot]);
  await runCli(["new", "--name", opts.name, "--planner", opts.planner, "--no-up"], { cwd: wsRoot });

  // weave up — WEAVER_NO_GHOSTTY skips the window pop. tmux session is live.
  await runCli(["up", "--project", opts.name, "--panes", String(opts.panes)], {
    cwd: wsRoot,
    env: { WEAVER_NO_GHOSTTY: "1" },
  });

  const session = `weave-${opts.name}`;
  liveSession = session;
  return { session, project: opts.name, ws: wsRoot };
}

async function runCli(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<string> {
  const proc = Bun.spawn(["weave", ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`weave ${args.join(" ")} failed (${code}): ${stderr}\n${stdout}`);
  return stdout;
}

// Send a multi-line prompt to a tmux pane and submit. Uses send-keys with a
// single-string arg + a separate Enter press, which is the only way to reliably
// avoid send-keys interpreting embedded newlines as multiple submits.
async function sendPrompt(session: string, paneIdx: number, prompt: string): Promise<void> {
  const target = `${session}:0.${paneIdx}`;
  // Replace newlines with spaces — claude TUI accepts long single-line prompts
  // and they're more reliable than multi-line via send-keys.
  const oneline = prompt.replace(/\s+/g, " ").trim();
  await Bun.spawn(["tmux", "send-keys", "-t", target, oneline], { stdout: "ignore" }).exited;
  await new Promise((r) => setTimeout(r, 200));
  await Bun.spawn(["tmux", "send-keys", "-t", target, "Enter"], { stdout: "ignore" }).exited;
}

// Poll the planner pane until `marker` regex matches, or timeoutMs elapses.
// Returns the captured pane content on match, throws on timeout.
async function waitForOutput(session: string, paneIdx: number, marker: RegExp, timeoutMs: number): Promise<string> {
  const target = `${session}:0.${paneIdx}`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const proc = Bun.spawn(["tmux", "capture-pane", "-p", "-t", target, "-S", "-200"], { stdout: "pipe" });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    if (marker.test(text)) return text;
    await new Promise((r) => setTimeout(r, 1500));
  }
  // Final capture for the failure message.
  const proc = Bun.spawn(["tmux", "capture-pane", "-p", "-t", target, "-S", "-100"], { stdout: "pipe" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  throw new Error(`timeout (${timeoutMs}ms) waiting for ${marker} in ${target}. Last 100 lines:\n${text}`);
}

describe("e2e dispatch evals (gated by WEAVER_RUN_EVALS=1)", () => {
  beforeAll(() => {
    if (!ENABLED) {
      console.log("\n  ℹ️  e2e evals SKIPPED — set WEAVER_RUN_EVALS=1 to run (consumes API tokens, ~30-90s/test).\n");
    } else if (!PLANNER) {
      console.log("\n  ⚠️  e2e evals SKIPPED — neither `claude` nor `codex` is on PATH and runnable.\n     Install one to enable evals (claude preferred).\n");
    } else {
      console.log(`\n  🧪 e2e evals enabled — using planner binary: ${PLANNER}\n`);
    }
  });

  // FLAT DISPATCH — works today. Regression net for Phase 1 (CHA-1145).
  // Verifies: planner spawns 3 workers in parallel, each computes a math
  // problem via claude -p, planner reads the results and reports the totals.
  skipIf("flat dispatch: planner → 3 parallel workers → consolidated results", async () => {
    // PLANNER is non-null here — skipIf only enables this test when picker succeeded.
    const { session } = await setupEvalProject({ name: "eval-flat", panes: 3, planner: PLANNER! });

    // Give claude in pane 0 ~8s to fully render its TUI before we type.
    await new Promise((r) => setTimeout(r, 8000));

    // Claude shows a "Do you trust this folder?" dialog the first time it
    // opens a fresh dir (the temp workspace). Default highlight is "Yes",
    // so a bare Enter accepts. Tap it twice with a small gap in case the
    // first hits during render.
    for (let i = 0; i < 2; i++) {
      await Bun.spawn(["tmux", "send-keys", "-t", `${session}:0.0`, "Enter"], { stdout: "ignore" }).exited;
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Wait for the input prompt to appear (the ❯ chevron is the marker).
    await waitForOutput(session, 0, /❯/, 30_000).catch(() => {/* fall through, capture happens in main wait */});

    await sendPrompt(session, 0, `
      End-to-end eval. Run this exact Bash:
      (weave dispatch worker-1 --binary claude "what is 1+1, reply with just the number, no explanation" &
       weave dispatch worker-2 --binary claude "what is 1+2, reply with just the number, no explanation" &
       weave dispatch worker-3 --binary claude "what is 1+3, reply with just the number, no explanation" &
       wait) && sleep 18 && for i in 1 2 3; do echo "--- worker-$i ---"; tmux capture-pane -p -t ${session}:0.$i -S -6 | tail -4; done
      Then report each result as a line "worker-N done: <number>". Three lines, nothing else.
    `);

    // Wait up to 3 minutes for the planner to dispatch + workers to compute + planner to report.
    const output = await waitForOutput(session, 0, /worker-1 done: 2/, 180_000);
    expect(output).toMatch(/worker-1 done:\s*2/);
    expect(output).toMatch(/worker-2 done:\s*3/);
    expect(output).toMatch(/worker-3 done:\s*4/);
  }, 240_000);

  // SUB-PLANNER — pending Phase 2 (CHA-1147). The capability isn't built yet:
  // workers can't themselves spawn workers, the layout doesn't support a third
  // column, and pane registry has no parentPaneId. This test will light up
  // when those land — it documents what the acceptance criteria look like.
  test.skip("sub-planner hierarchy: main → 2 sub-planners → 4 workers → results bubble up", async () => {
    // Pseudo-spec — implement when Phase 2 ships:
    //
    // const { session } = await setupEvalProject({ name: "eval-sub", panes: 0, planner: "claude" });
    // await sendPrompt(session, 0, `
    //   Spawn 2 sub-planners. Sub-planner 1 spawns 2 workers computing 1+1 and 1+2.
    //   Sub-planner 2 spawns 2 workers computing 1+3 and 1+4.
    //   Aggregate at each level. Final report: a line per worker
    //   ("sub-1.worker-1 done: 2", "sub-2.worker-2 done: 5", etc.) AND a line per
    //   sub-planner ("sub-1 aggregate: [2, 3]", "sub-2 aggregate: [4, 5]").
    // `);
    //
    // const output = await waitForOutput(session, 0, /sub-2 aggregate.*4.*5/, 300_000);
    // expect(output).toMatch(/sub-1\.worker-1 done:\s*2/);
    // ...
  });

  // DONE-DETECTION — pending CHA-1151. Right now `weave tail --wait-done`
  // hangs for claude workers because tail.ts only knows codex's JSON event
  // shape. This test will light up when claude stream-json + plain-text
  // terminal detection ships.
  test.skip("weave tail --wait-done returns within 30s of claude worker completion", async () => {
    // Pseudo-spec:
    //
    // dispatch a claude worker with a 5s task; immediately call
    // `weave tail worker-1 --wait-done` from a child process; assert it exits
    // 0 within 30s with the worker's final output captured.
  });
});
