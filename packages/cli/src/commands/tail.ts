import { findWorkspace, listPaneRecords, getPaneRecord, setPaneStatus } from "@weaver/core";

// `weave tail <worker> [--follow] [--wait-done] [--since <byte>]` — read a
// worker's run file (~/.weave/runs/<paneid>.jsonl) and print structured
// events. Three modes:
//
//   no flags        Print everything currently in the file, then exit.
//   --follow        Like `tail -f` — keep printing new lines as they arrive.
//   --wait-done     Block until codex emits a turn-complete event, then print
//                   the final assistant message and exit 0. Used by the
//                   planner to synchronize on N parallel dispatches.
//
// Done-detection: codex's `--json` mode emits per-turn events. We treat any
// of these terminal types as completion:
//   - `{"type":"turn.completed", ...}`
//   - `{"type":"task_complete", ...}` (older codex)
//   - The final message before stdin EOF / pane exit
//
// Final result extraction: the last `agent_message` event's text, or the
// last assistant text in `turn.completed`, or the last non-empty line.

export type TailOpts = {
  worker: string;
  follow?: boolean;
  waitDone?: boolean;
  since?: number;
};

export async function runTail(opts: TailOpts): Promise<void> {
  if (!opts.worker) {
    console.error("usage: weave tail <worker-N | %paneid> [--follow] [--wait-done]");
    process.exit(1);
  }

  const ws = await findWorkspace();
  if (!ws) {
    console.error("not inside a Weaver workspace");
    process.exit(1);
  }

  const pane = await resolveWorker(opts.worker, ws.root);
  if (!pane) {
    console.error(`no worker matches "${opts.worker}"`);
    process.exit(1);
  }

  const file = pane.runFile;
  // Default the tail offset to the pane's lastReviewedByte (set by `weave
  // dispatch` to the run-file size at dispatch time). This way, --wait-done
  // only sees events from the current dispatch, not historical content left
  // over from the same pane id being reused across sessions or from prior
  // tasks on the same worker. --since explicit override wins.
  let offset = opts.since ?? pane.lastReviewedByte ?? 0;
  let buf = "";
  let finalMessage: string | null = null;
  const slot = pane.workerNum != null ? `worker-${pane.workerNum}` : pane.id;

  // Helper: read file from `offset` to EOF, return new offset + parsed lines.
  async function readNew(): Promise<{ newOffset: number; events: any[] }> {
    const f = Bun.file(file);
    if (!(await f.exists())) return { newOffset: offset, events: [] };
    const size = f.size;
    if (size <= offset) return { newOffset: offset, events: [] };
    const slice = await f.slice(offset, size).text();
    const newOffset = size;
    buf += slice;
    const events: any[] = [];
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // Non-JSON line (banner / shell echo) — pass through as raw text.
        events.push({ type: "raw", text: line });
      }
    }
    return { newOffset, events };
  }

  // Single-pass mode (no --follow, no --wait-done): drain and exit.
  if (!opts.follow && !opts.waitDone) {
    const { events } = await readNew();
    for (const e of events) printEvent(slot, e);
    return;
  }

  // Polling loop. Two strategies:
  //
  //   (A) Structured-event detection — for non-interactive workers that emit
  //       codex `--json` or claude `--output-format stream-json`. We see
  //       proper terminal events (turn.completed / result.success) in the
  //       run file. This is the original path.
  //
  //   (B) Pane-stability detection — for interactive workers (codex TUI,
  //       claude TUI). The run file captures rendered terminal output (full
  //       of ANSI escapes, no clean event boundaries). Instead we check
  //       whether the worker's tmux pane has been quiet for ~5s AND its
  //       current command is back to a shell (codex/claude has exited or
  //       paused) OR the rendered last line ends in an idle prompt marker.
  //       Result is then the captured pane content since dispatch.
  //
  // Both run in parallel. First one to fire wins.
  let stableSince = Date.now();
  let lastSize = 0;
  while (true) {
    const { newOffset, events } = await readNew();
    offset = newOffset;
    for (const e of events) {
      printEvent(slot, e);
      const msg = extractAssistantMessage(e);
      if (msg) finalMessage = msg;
      if (isTerminal(e) && opts.waitDone) {
        await setPaneStatus(pane.id, "completed");
        if (finalMessage) console.log(`${slot} done: ${finalMessage}`);
        else console.log(`${slot} done`);
        return;
      }
    }
    // Pane-stability path for interactive TUI workers.
    if (opts.waitDone) {
      const f = Bun.file(file);
      const size = (await f.exists()) ? f.size : 0;
      if (size !== lastSize) {
        lastSize = size;
        stableSince = Date.now();
      }
      // ~5s of no run-file growth → likely TUI is idle. Verify by checking
      // tmux pane current_command — if it's a shell, the agent has exited.
      // If still claude/codex, the agent is between turns waiting for input
      // (ALSO a valid completion state for our dispatch-once flow).
      if (Date.now() - stableSince > 5000 && size > (opts.since ?? pane.lastReviewedByte ?? 0)) {
        const captured = await captureWorkerSinceDispatch(pane.id, opts.since ?? pane.lastReviewedByte ?? 0, lastSize - (opts.since ?? pane.lastReviewedByte ?? 0));
        const result = extractFromTuiCapture(captured);
        await setPaneStatus(pane.id, "completed");
        console.log(`${slot} done: ${result || "(no result captured)"}`);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Capture the worker pane's content (rendered text). Used for interactive TUI
// workers where the run file is full of ANSI escapes and we want the user-
// visible output. Returns the last ~600 lines of pane scrollback (enough for
// any single dispatch).
async function captureWorkerSinceDispatch(paneId: string, _sinceByte: number, _lengthBytes: number): Promise<string> {
  const proc = Bun.spawn(["tmux", "capture-pane", "-p", "-t", paneId, "-S", "-600"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

// Extract the most recent assistant text from a captured TUI pane. Codex's
// TUI uses panel formatting; we look for the chunk between the last user
// prompt indicator and the next idle prompt. As a safety net, return the
// full captured text if no marker is found — the planner can read it.
function extractFromTuiCapture(captured: string): string {
  // Strip ANSI escapes.
  const clean = captured.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g, "");
  const lines = clean.split("\n");
  // Find the last line that looks like an idle shell prompt (after codex/claude exited).
  // codex inline-mode tends to print a "thinking" / panels and then return to the user's
  // shell prompt (e.g. `➜  weave`). Take everything BEFORE that final prompt.
  let endIdx = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trimEnd();
    if (/^(➜|\$|>)\s/.test(l)) { endIdx = i; break; }
  }
  // Find a reasonable start — last 60 lines is plenty for a turn.
  const start = Math.max(0, endIdx - 60);
  return lines.slice(start, endIdx).join("\n").trim();
}

function isTerminal(e: any): boolean {
  if (!e || typeof e.type !== "string") return false;
  return (
    // codex event names
    e.type === "turn.completed" ||
    e.type === "task_complete" ||
    e.type === "task.completed" ||
    e.type === "session.completed" ||
    // claude --output-format stream-json — emits one final {type:"result", subtype:"success"|"error_*", ...}
    (e.type === "result" && (e.subtype === "success" || (typeof e.subtype === "string" && e.subtype.startsWith("error"))))
  );
}

// Pull the final assistant text out of a codex / claude event. Shapes vary
// across binaries and versions — accept the known ones, fall back to raw.
function extractAssistantMessage(e: any): string | null {
  if (!e) return null;
  // codex
  if (e.type === "agent_message" && typeof e.text === "string") return e.text.trim();
  if (e.type === "item.completed" && e.item && typeof e.item.text === "string") return e.item.text.trim();
  if (e.type === "turn.completed" && e.message && typeof e.message.content === "string") return e.message.content.trim();
  // claude stream-json: terminal `result` carries the final string in .result
  if (e.type === "result" && typeof e.result === "string") return e.result.trim();
  // claude stream-json: assistant turns carry text in .message.content[].text
  if (e.type === "assistant" && e.message && Array.isArray(e.message.content)) {
    const text = e.message.content
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("");
    if (text) return text.trim();
  }
  // raw / unparsed
  if (e.type === "raw" && typeof e.text === "string") return e.text.trim();
  return null;
}

function printEvent(slot: string, e: any) {
  if (e.type === "raw") {
    console.log(`[${slot}] ${e.text}`);
    return;
  }
  // Compact one-liner for known event types; full JSON for the rest.
  if (e.type === "agent_message" || e.type === "item.completed") {
    const m = extractAssistantMessage(e);
    if (m) console.log(`[${slot}] ${m}`);
    return;
  }
  if (e.type === "turn.completed" || e.type === "task.completed") {
    console.log(`[${slot}] (turn complete)`);
    return;
  }
  if (e.type === "tool_call" || e.type === "tool.call") {
    const name = e.name ?? e.tool ?? "?";
    console.log(`[${slot}] tool: ${name}`);
    return;
  }
  console.log(`[${slot}] ${JSON.stringify(e)}`);
}

async function resolveWorker(token: string, workspaceRoot: string) {
  if (token.startsWith("%")) return await getPaneRecord(token);
  const m = token.match(/^worker-(\d+)$/);
  if (m) {
    const want = parseInt(m[1]!, 10);
    // Same fallback chain as dispatch's resolveWorker — env first, then ws,
    // then any. See dispatch.ts comment for why ALL is the safety net.
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
  const direct = await getPaneRecord(token);
  if (direct) return direct;
  return (await getPaneRecord(`%${token}`)) ?? null;
}
