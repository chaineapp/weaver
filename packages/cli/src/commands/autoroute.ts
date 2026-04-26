// `weave autoroute --project X` — long-running daemon that closes the loop
// between the planner Claude session and its worker panes.
//
// The flow it enables (everything is in CLAUDE.md/AGENTS.md):
//
//   1. User talks to planner in pane 0 (interactive Claude TUI).
//   2. Planner replies with one or more structured @@DISPATCH blocks at the
//      end of its turn:
//
//          @@DISPATCH worker-1
//          <prompt for worker 1>
//          @@END
//
//          @@DISPATCH worker-2
//          <prompt for worker 2>
//          @@END
//
//   3. autoroute (this daemon) tails the planner's run file, ANSI-strips,
//      and detects new @@DISPATCH ... @@END blocks once the planner's turn
//      is stable (the file has stopped growing for a beat).
//   4. For each block, autoroute runs `weave dispatch worker-N "<prompt>"`
//      with the planner's WEAVER_AUTOROUTE_CWD (defaults to ~/Code/weaver)
//      so the worker runs in the right repo.
//   5. autoroute polls each worker's run file for the terminal `result`
//      event (claude stream-json shape). When all dispatched workers
//      have completed, it formats their results into a single user-message
//      block and tmux-pastes it into the planner pane:
//
//          @@RESULT worker-1
//          <final assistant text>
//          @@END
//
//          @@RESULT worker-2
//          <final assistant text>
//          @@END
//
//   6. The planner reads the @@RESULT blocks as its next user turn, decides
//      what to do (more dispatches, ask the user a question, declare the
//      goal complete), and the loop continues.
//
// The whole point: the user just speaks to the planner. No manual `weave
// dispatch` / `weave tail` Bash. autoroute does the wire-up.

import { findWorkspace, getProject, listPaneRecords, getPaneRecord, weavePaths } from "@weaver/core";
import { runDispatch } from "./dispatch.ts";
import { writeFileSync } from "node:fs";

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]|\r/g;
const DISPATCH_RE = /@@DISPATCH\s+(worker-\d+)\s*\n([\s\S]*?)\n@@END/g;

export type AutorouteOpts = {
  project: string;
  cwd?: string;     // fallback worker cwd (default: process.cwd())
  binary?: string;  // worker binary (default: claude)
};

export async function runAutoroute(opts: AutorouteOpts): Promise<void> {
  const ws = await findWorkspace();
  if (!ws) {
    console.error("autoroute: not in a Weaver workspace");
    process.exit(1);
  }
  const project = await getProject(ws, opts.project);
  if (!project) {
    console.error(`autoroute: no project ${opts.project}`);
    process.exit(1);
  }

  const session = `weave-${project.id}`;
  const workerCwd = opts.cwd ?? process.cwd();
  const binary = opts.binary ?? "claude";
  const logPrefix = `[autoroute ${project.id}]`;

  // Find planner pane (idx 0). Its run file is in panes.json once `weave up`
  // pipe-paned it. Until then, fall back to scanning ~/.weave/runs/.
  let plannerRunFile: string | null = null;
  for (let i = 0; i < 20; i++) {
    const all = await listPaneRecords({ projectId: project.id });
    // Planner is the pane in this project that ISN'T a numbered worker.
    // We registered the planner via pipePane in up.ts but it doesn't have a
    // PaneRecord — only workers do. So we resolve via tmux.
    const tmuxPanes = await tmuxList(session);
    const planner = tmuxPanes.find((p) => p.idx === 0);
    if (planner) {
      plannerRunFile = weavePaths().runFile(planner.id);
      break;
    }
    await sleep(500);
  }
  if (!plannerRunFile) {
    console.error(`${logPrefix} could not find planner pane in ${session}`);
    process.exit(1);
  }
  console.log(`${logPrefix} watching ${plannerRunFile}`);

  // Track which dispatch-block hashes we've already processed so the same
  // block in a re-rendered TUI capture doesn't fire twice.
  const processed = new Set<string>();
  let lastSize = 0;
  let stableSince = 0;

  while (true) {
    if (!(await tmuxHasSession(session))) {
      console.log(`${logPrefix} session ${session} gone; exiting`);
      return;
    }
    const file = Bun.file(plannerRunFile);
    if (!(await file.exists())) {
      await sleep(2000);
      continue;
    }
    const size = file.size;
    const grew = size !== lastSize;
    lastSize = size;
    if (grew) {
      stableSince = Date.now();
      await sleep(1500);
      continue;
    }
    // Wait until ≥3s of no growth → planner finished its turn.
    if (Date.now() - stableSince < 3000) {
      await sleep(1500);
      continue;
    }

    const raw = await file.text();
    const clean = stripAnsi(raw);
    const blocks = [...clean.matchAll(DISPATCH_RE)].map((m) => ({
      worker: m[1]!,
      prompt: m[2]!.trim(),
      key: hash(`${m[1]}|${m[2]}`),
    }));
    const fresh = blocks.filter((b) => !processed.has(b.key));
    if (fresh.length === 0) {
      stableSince = Date.now() + 60_000; // long pause; nothing to do
      await sleep(2000);
      continue;
    }
    for (const b of fresh) processed.add(b.key);

    console.log(`${logPrefix} dispatching ${fresh.length} block(s)`);
    // Dispatch all in parallel.
    await Promise.all(
      fresh.map(async (b) => {
        try {
          await runDispatch({
            worker: b.worker,
            task: b.prompt,
            binary,
            cwd: workerCwd,
          });
          console.log(`${logPrefix} → ${b.worker}: ${b.prompt.slice(0, 80)}…`);
        } catch (err) {
          console.error(`${logPrefix} dispatch ${b.worker} failed: ${(err as Error).message}`);
        }
      }),
    );

    // Wait for all dispatched workers to reach status=completed (or fail
    // out). Hard-cap at 10 minutes so a stuck worker doesn't hang autoroute.
    const startWait = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000;
    const targetWorkers = new Set(fresh.map((b) => b.worker));
    const results: { worker: string; result: string }[] = [];
    while (Date.now() - startWait < TIMEOUT_MS) {
      const records = await listPaneRecords({ projectId: project.id });
      const relevant = records.filter((r) => r.workerNum != null && targetWorkers.has(`worker-${r.workerNum}`));
      const allDone = relevant.length === targetWorkers.size && relevant.every((r) => r.status === "completed" || r.status === "failed");
      if (allDone) {
        for (const r of relevant) {
          const slot = `worker-${r.workerNum}`;
          const text = await extractFinalResult(r.runFile, r.lastReviewedByte);
          results.push({ worker: slot, result: text || "(no output captured)" });
        }
        break;
      }
      await sleep(2000);
    }
    if (results.length === 0) {
      console.warn(`${logPrefix} timed out waiting for workers; injecting timeout notice`);
      for (const b of fresh) results.push({ worker: b.worker, result: "(timeout — no result within 10m)" });
    }

    // Format and inject as a tmux paste-buffer (preserves newlines) + Enter.
    const message = results
      .map((r) => `@@RESULT ${r.worker}\n${r.result}\n@@END`)
      .join("\n\n");
    await injectIntoPlanner(session, message);
    console.log(`${logPrefix} injected ${results.length} result(s) into planner`);
    stableSince = Date.now();
  }
}

// ───── helpers ─────

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function hash(s: string): string {
  // Cheap deterministic hash so we can dedupe without crypto.
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return String(h);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function tmuxHasSession(session: string): Promise<boolean> {
  const proc = Bun.spawn(["tmux", "has-session", "-t", session], { stdout: "ignore", stderr: "ignore" });
  return (await proc.exited) === 0;
}

async function tmuxList(session: string): Promise<{ id: string; idx: number }[]> {
  const proc = Bun.spawn(["tmux", "list-panes", "-t", session, "-F", "#{pane_id}|#{pane_index}"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, idx] = line.split("|");
      return { id: id!, idx: Number(idx) };
    });
}

// Pull the final assistant text from a worker's run file, starting at the
// dispatch-time watermark. claude --output-format stream-json emits a
// terminal {type:"result", subtype:"success", result:"..."} — that's what
// we want. Falls back to scraping the last assistant.message.content text.
async function extractFinalResult(runFile: string, sinceByte: number): Promise<string | null> {
  const file = Bun.file(runFile);
  if (!(await file.exists())) return null;
  const slice = await file.slice(sinceByte, file.size).text();
  // claude stream-json lines are mixed in with raw terminal junk (because
  // pipe-pane captures the rendered terminal). Find JSON objects.
  let lastResult: string | null = null;
  let lastAssistant: string | null = null;
  for (const line of slice.split("\n")) {
    const idx = line.indexOf("{\"type\":\"");
    if (idx < 0) continue;
    const json = line.slice(idx);
    try {
      const e = JSON.parse(json);
      if (e.type === "result" && (e.subtype === "success" || (typeof e.subtype === "string" && e.subtype.startsWith("error")))) {
        if (typeof e.result === "string") lastResult = e.result;
      } else if (e.type === "assistant" && e.message && Array.isArray(e.message.content)) {
        const text = e.message.content
          .filter((c: any) => c?.type === "text" && typeof c.text === "string")
          .map((c: any) => c.text)
          .join("");
        if (text) lastAssistant = text;
      }
    } catch { /* malformed JSON line — skip */ }
  }
  return (lastResult ?? lastAssistant ?? "").trim() || null;
}

// Inject a multi-line message into the planner pane via tmux paste-buffer.
// Direct send-keys doesn't preserve newlines well; paste-buffer does.
async function injectIntoPlanner(session: string, message: string): Promise<void> {
  // Wrap message in markers so the planner can recognize it deterministically.
  const wrapped = `\n\n${message}\n\n`;
  // Write to a temp file, load as buffer, paste, send Enter.
  const tmp = `/tmp/weaver-inject-${process.pid}-${Date.now()}.txt`;
  writeFileSync(tmp, wrapped);
  await Bun.spawn(["tmux", "load-buffer", tmp], { stdout: "ignore", stderr: "ignore" }).exited;
  await Bun.spawn(["tmux", "paste-buffer", "-t", `${session}:0.0`], { stdout: "ignore", stderr: "ignore" }).exited;
  await sleep(200);
  await Bun.spawn(["tmux", "send-keys", "-t", `${session}:0.0`, "Enter"], { stdout: "ignore", stderr: "ignore" }).exited;
  // Cleanup temp file.
  try { (await import("node:fs")).unlinkSync(tmp); } catch { /* ignore */ }
}
