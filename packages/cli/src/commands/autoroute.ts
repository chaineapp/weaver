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
//   3. autoroute (this daemon) tails Claude Code's session log at
//      ~/.claude/projects/<encoded-cwd>/<sessionid>.jsonl. That log has
//      clean structured assistant turns — far better than pipe-paning the
//      TUI, which captures rendered terminal output (overwrite-each-other
//      cursor moves, multiple copies of the same text mid-stream, etc.)
//      and ate ~half the @@DISPATCH markers.
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

import { findWorkspace, getProject, listPaneRecords, getPaneRecord, weavePaths, workspacePaths } from "@weaver/core";
import { runDispatch } from "./dispatch.ts";
import { writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";

const DISPATCH_RE = /@@DISPATCH\s+(worker-\d+)\s*\n([\s\S]*?)\n@@END/g;

// Claude Code encodes the planner's cwd into a flat dirname under
// ~/.claude/projects/. Rule (verified empirically): every non-alphanumeric
// char becomes `-`. So /Users/pom/Code/.weaver/projects/weave becomes
// -Users-pom-Code--weaver-projects-weave (note the `--` from the leading `.`).
function claudeProjectDir(cwd: string): string {
  return join(homedir(), ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
}

// Find the newest *.jsonl in a Claude project dir. Claude makes a new file
// per session id; tailing the newest gives us the live conversation.
function newestSessionLog(dir: string): string | null {
  try {
    const entries = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    if (entries.length === 0) return null;
    let newest = "";
    let newestMtime = 0;
    for (const f of entries) {
      const full = join(dir, f);
      const m = statSync(full).mtimeMs;
      if (m > newestMtime) { newestMtime = m; newest = full; }
    }
    return newest || null;
  } catch { return null; }
}

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

  // Where claude logs the planner's conversation. Planner cwd is the project
  // folder under workspace/.weaver/projects/<id> (set by `weave up`).
  const plannerCwd = join(workspacePaths(ws.root).projectsDir, project.id);
  const claudeLogDir = claudeProjectDir(plannerCwd);
  console.log(`${logPrefix} watching claude session logs in ${claudeLogDir}`);

  // Track which dispatch-block hashes we've already processed so the same
  // block scanned across many polls doesn't fire twice. Seeded on startup
  // (and on log-file switch) with every block currently in the log so we
  // don't re-fire historical blocks from previous sessions that the user
  // already saw results for.
  const processed = new Set<string>();
  let lastLogPath: string | null = null;
  let lastSize = 0;
  let stableSince = 0;
  let seededFor: string | null = null;

  while (true) {
    if (!(await tmuxHasSession(session))) {
      console.log(`${logPrefix} session ${session} gone; exiting`);
      return;
    }
    // Always scan for the newest session log — claude makes a new file when
    // the user starts a new session via /clear or restart.
    const logPath = newestSessionLog(claudeLogDir);
    if (!logPath) {
      await sleep(2000);
      continue;
    }
    if (logPath !== lastLogPath) {
      console.log(`${logPrefix} switched to ${logPath}`);
      lastLogPath = logPath;
      lastSize = 0;
    }
    const file = Bun.file(logPath);
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

    // Parse the session log: one JSON event per line. Pull text from
    // assistant turns. Run DISPATCH_RE over the assembled assistant text.
    const raw = await file.text();
    const assistantText: string[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.type === "assistant" && e.message && Array.isArray(e.message.content)) {
          for (const c of e.message.content) {
            if (c?.type === "text" && typeof c.text === "string") assistantText.push(c.text);
          }
        }
      } catch { /* malformed line — skip */ }
    }
    const clean = assistantText.join("\n\n");
    const blocks = [...clean.matchAll(DISPATCH_RE)].map((m) => ({
      worker: m[1]!,
      prompt: m[2]!.trim(),
      key: hash(`${m[1]}|${m[2]}`),
    }));

    // First time we see this log file (startup or session switch), seed
    // `processed` with every block already in it. We assume any blocks
    // present at startup were already handled in a prior life — refire
    // would just confuse the user with duplicate worker results. Only
    // dispatch blocks the user emits AFTER autoroute is watching.
    if (seededFor !== logPath) {
      for (const b of blocks) processed.add(b.key);
      seededFor = logPath;
      const seedCount = blocks.length;
      console.log(`${logPrefix} seeded ${seedCount} pre-existing block(s) as already-processed`);
      continue;
    }
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

    // Wait for all dispatched workers to emit a terminal claude `result`
    // event in their run files. We can't rely on PaneRecord.status because
    // only `weave tail --wait-done` flips it — autoroute doesn't run tail.
    // Instead, poll each worker's run file directly for the result event,
    // starting from the dispatch-time watermark.
    const startWait = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000;
    const targetWorkers = new Set(fresh.map((b) => b.worker));
    const results: { worker: string; result: string }[] = [];
    const records = await listPaneRecords({ projectId: project.id });
    const relevant = records.filter((r) => r.workerNum != null && targetWorkers.has(`worker-${r.workerNum}`));
    const pending = new Map<string, { runFile: string; sinceByte: number }>();
    for (const r of relevant) {
      pending.set(`worker-${r.workerNum}`, { runFile: r.runFile, sinceByte: r.lastReviewedByte });
    }
    while (pending.size > 0 && Date.now() - startWait < TIMEOUT_MS) {
      for (const [slot, info] of pending) {
        const text = await extractFinalResult(info.runFile, info.sinceByte);
        if (text != null) {
          results.push({ worker: slot, result: text });
          pending.delete(slot);
          console.log(`${logPrefix} ← ${slot} done (${text.slice(0, 80).replace(/\n/g, " ")}…)`);
        }
      }
      if (pending.size > 0) await sleep(2000);
    }
    if (pending.size > 0) {
      console.warn(`${logPrefix} timed out on: ${[...pending.keys()].join(", ")}`);
      for (const slot of pending.keys()) {
        results.push({ worker: slot, result: "(timeout — no result within 10m)" });
      }
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
// dispatch-time watermark. Returns null if the worker hasn't emitted a
// terminal result yet (so autoroute keeps polling). Returns the text as
// soon as a terminal {type:"result", subtype:"success"} event lands.
async function extractFinalResult(runFile: string, sinceByte: number): Promise<string | null> {
  const file = Bun.file(runFile);
  if (!(await file.exists())) return null;
  const slice = await file.slice(sinceByte, file.size).text();
  // claude stream-json lines are mixed in with raw terminal junk (because
  // pipe-pane captures the rendered terminal). Find JSON objects.
  for (const line of slice.split("\n")) {
    const idx = line.indexOf('{"type":"result"');
    if (idx < 0) continue;
    const json = line.slice(idx);
    try {
      const e = JSON.parse(json);
      if (e.type === "result" && (e.subtype === "success" || (typeof e.subtype === "string" && e.subtype.startsWith("error")))) {
        if (typeof e.result === "string" && e.result.trim()) return e.result.trim();
        // result event with empty result — fall through to assistant scan
      }
    } catch { /* truncated mid-stream; keep waiting */ }
  }
  // No terminal result event yet → not done. (Don't return last-assistant
  // as a fallback; we want to wait for actual completion, not interim text.)
  return null;
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
