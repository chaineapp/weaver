import { runDispatch } from "./dispatch.ts";
import { runTail } from "./tail.ts";

// `weave dispatch-batch '<json>'` — fan out N tasks to N workers in parallel,
// wait for all to complete, return aggregated results in a single deterministic
// block. Used by the /weaver:dispatch-batch slash command's subagent so the
// subagent only ever has to make ONE Bash call (no jq parsing, no shell loops,
// no `&` + `wait` orchestration in the subagent prompt — those are brittle for
// a model to generate cleanly).
//
// Input JSON shape:
//   { "worker-1": "task string", "worker-2": "task string", ... }
//
//   ...or per-worker overrides:
//   { "worker-1": { "task": "...", "binary": "codex", "bypass": true,
//                   "model": "...", "cwd": "/path" }, ... }
//
// Output (printed to stdout, parsed by the calling subagent):
//   ===== worker-1 =====
//   <final assistant text from worker-1>
//
//   ===== worker-2 =====
//   <final assistant text from worker-2>
//
//   ...

export type BatchOpts = {
  json: string;
  binary?: string;   // default applied to every worker that doesn't override
  bypass?: boolean;
  model?: string;
  cwd?: string;
};

type WorkerSpec = {
  worker: string;
  task: string;
  binary?: string;
  bypass?: boolean;
  model?: string;
  cwd?: string;
};

export async function runDispatchBatch(opts: BatchOpts): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(opts.json);
  } catch (err) {
    console.error(`weave dispatch-batch: invalid JSON: ${(err as Error).message}`);
    process.exit(1);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error(`weave dispatch-batch: expected a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`);
    process.exit(1);
  }

  // Normalize per-worker specs.
  const specs: WorkerSpec[] = [];
  for (const [worker, val] of Object.entries(parsed)) {
    if (!/^worker-\d+$/.test(worker)) {
      console.error(`weave dispatch-batch: bad worker id "${worker}" — must match worker-N`);
      process.exit(1);
    }
    let spec: WorkerSpec;
    if (typeof val === "string") {
      spec = { worker, task: val };
    } else if (val && typeof val === "object") {
      const o = val as Record<string, unknown>;
      const task = typeof o.task === "string" ? o.task : "";
      if (!task) {
        console.error(`weave dispatch-batch: ${worker} object form must have "task"`);
        process.exit(1);
      }
      spec = {
        worker,
        task,
        binary: typeof o.binary === "string" ? o.binary : undefined,
        bypass: typeof o.bypass === "boolean" ? o.bypass : undefined,
        model: typeof o.model === "string" ? o.model : undefined,
        cwd: typeof o.cwd === "string" ? o.cwd : undefined,
      };
    } else {
      console.error(`weave dispatch-batch: ${worker} value must be string or object`);
      process.exit(1);
    }
    // Apply batch-level defaults (cli flags) for anything the spec didn't set.
    if (spec.binary === undefined) spec.binary = opts.binary;
    if (spec.bypass === undefined) spec.bypass = opts.bypass;
    if (spec.model === undefined) spec.model = opts.model;
    if (spec.cwd === undefined) spec.cwd = opts.cwd;
    specs.push(spec);
  }
  if (specs.length === 0) {
    console.error(`weave dispatch-batch: no workers in JSON`);
    process.exit(1);
  }

  // Fire all dispatches in parallel. runDispatch's own setLastReviewedByte
  // + sendKeys are atomic per the panes.json mkdir-spinlock, so there's no
  // race between concurrent invocations.
  await Promise.all(
    specs.map(async (s) => {
      try {
        await runDispatch({
          worker: s.worker,
          task: s.task,
          binary: s.binary,
          bypass: s.bypass,
          model: s.model,
          cwd: s.cwd,
        });
      } catch (err) {
        // Don't fail the whole batch — capture per-worker errors so the
        // tail step still tries the others.
        console.error(`[${s.worker}] dispatch failed: ${(err as Error).message}`);
      }
    }),
  );

  // Wait for every dispatched worker in parallel. We spawn `weave tail
  // --wait-done` as a subprocess per worker so each capture is truly
  // isolated — no shared process.stdout.write hijack races. Each subprocess
  // returns the worker's final assistant text via its stdout.
  const weaveBin = process.argv[1] && process.argv[1].endsWith("/weave")
    ? process.argv[1]
    : "weave"; // fallback to PATH lookup
  const results = await Promise.all(
    specs.map(async (s) => {
      const proc = Bun.spawn([weaveBin, "tail", s.worker, "--wait-done"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      // runTail prints a final `<slot> done: <text>` line — pull just the text.
      // Match across the multi-line stream-json noise that prefixes it.
      const lines = stdout.split("\n");
      let final = "";
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!;
        const idx = line.indexOf(`${s.worker} done:`);
        if (idx >= 0) {
          final = line.slice(idx + `${s.worker} done:`.length).trim();
          break;
        }
      }
      return { worker: s.worker, result: final || "(no result captured)" };
    }),
  );

  // Print deterministic aggregated output sorted by worker number.
  results.sort((a, b) => {
    const an = parseInt(a.worker.replace("worker-", ""), 10);
    const bn = parseInt(b.worker.replace("worker-", ""), 10);
    return an - bn;
  });
  for (const r of results) {
    console.log(`===== ${r.worker} =====`);
    console.log(r.result);
    console.log("");
  }
}
