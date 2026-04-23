#!/usr/bin/env bun
// Demo script emulating what the planner Claude would do via the Weaver MCP
// tools (spawn_pane + wait_for_updates + get_pane_output). Since this session
// predates the MCP registration, we call the underlying libraries directly.

import { spawnWorker } from "../packages/mcp-orchestrator/src/spawn.ts";
import {
  waitForUpdates,
  readEvents,
  setLastReviewedByte,
  getPaneRecord,
  paneSummary,
} from "../packages/core/src/index.ts";

const targets = [
  "/Users/pom/Code/chain5-rg-pr5-clean",
  "/Users/pom/Code/chain-zen-cha-613",
  "/Users/pom/Code/chaine-legacy",
];

const prompt = (dir: string) =>
  `Review the repo at ${dir}. List the top-level directories and files, identify the primary language/stack, and give me a 5-bullet summary of what this repo is for based on README and package manifest. Be concise.`;

console.log(`spawning ${targets.length} codex workers...\n`);
const panes = [];
for (const dir of targets) {
  const r = await spawnWorker({ task: prompt(dir), cwd: dir });
  console.log(`  ${r.id}  ${r.projectId}${r.worktreeId === "main" ? "" : `:${r.worktreeId}`}  →  ${dir}`);
  panes.push(r);
}

console.log(`\nrun files:`);
for (const p of panes) console.log(`  ${p.runFile}`);

console.log(`\nentering wait_for_updates loop...`);
const start = Date.now();
const done = new Set<string>();

while (done.size < panes.length && Date.now() - start < 180_000) {
  const updates = await waitForUpdates({ timeoutSeconds: 20, pollMs: 500 });
  if (updates.length === 0) {
    console.log(`  [${elapsed(start)}] no updates in 20s — checking statuses`);
    for (const p of panes) {
      if (done.has(p.id)) continue;
      const s = await paneSummary(p.id);
      console.log(`    ${p.id}: ${s.status}  turns=${s.turns}  tokens=${s.totalTokens}`);
      if (s.status === "completed" || s.status === "failed") done.add(p.id);
    }
    continue;
  }
  for (const u of updates) {
    if (done.has(u.pane_id)) continue;
    const rec = await getPaneRecord(u.pane_id);
    if (!rec) continue;
    const { events, endByte } = await readEvents(u.pane_id, { sinceByte: rec.lastReviewedByte });
    await setLastReviewedByte(u.pane_id, endByte);
    const summary = await paneSummary(u.pane_id);
    console.log(
      `  [${elapsed(start)}] ${u.pane_id}  +${u.new_bytes}B  status=${summary.status}  turns=${summary.turns}  events=${events.length}`,
    );
    // Show the last agent_message if any
    const lastMsg = [...events].reverse().find((e) => (e as any).item_type === "agent_message");
    if (lastMsg && (lastMsg as any).text) {
      console.log(`           msg: ${((lastMsg as any).text as string).slice(0, 150).replace(/\n/g, " ")}`);
    }
    if (summary.status === "completed" || summary.status === "failed") done.add(u.pane_id);
  }
}

console.log(`\nfinal:`);
for (const p of panes) {
  const s = await paneSummary(p.id);
  console.log(`  ${p.id}  ${s.status}  turns=${s.turns}  tokens=${s.totalTokens}  errors=${s.errorCount}`);
  if (s.lastMessage) console.log(`    final msg: ${s.lastMessage.slice(0, 300).replace(/\n/g, " ")}`);
}

function elapsed(start: number): string {
  const s = Math.floor((Date.now() - start) / 1000);
  return `${s}s`.padStart(4);
}
