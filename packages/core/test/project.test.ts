import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initProject,
  paths,
  upsertPaneRecord,
  listPaneRecords,
  setPaneStatus,
  readEvents,
  paneSummary,
} from "../src/index.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "weaver-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("initProject", () => {
  test("creates .weave/, .mcp.json, and config.json", async () => {
    const config = await initProject(dir);
    expect(config.projectName).toBe(await import("node:path").then((p) => p.basename(dir)));
    expect(config.tmuxSession).toMatch(/^weave-/);

    const p = paths(dir);
    expect(await Bun.file(p.mcpJson).exists()).toBe(true);
    expect(await Bun.file(p.config).exists()).toBe(true);

    const mcp = (await Bun.file(p.mcpJson).json()) as {
      mcpServers: { weaver: { command: string; args: string[] } };
    };
    expect(mcp.mcpServers.weaver.command).toBe("weave");
    expect(mcp.mcpServers.weaver.args).toEqual(["mcp"]);
  });

  test("merges with existing .mcp.json instead of overwriting", async () => {
    const p = paths(dir);
    await Bun.write(
      p.mcpJson,
      JSON.stringify({ mcpServers: { other: { command: "other", args: [] } } }, null, 2),
    );
    await initProject(dir);
    const merged = (await Bun.file(p.mcpJson).json()) as {
      mcpServers: Record<string, unknown>;
    };
    expect(merged.mcpServers.other).toBeDefined();
    expect(merged.mcpServers.weaver).toBeDefined();
  });

  test("re-running init without --force preserves existing config", async () => {
    const first = await initProject(dir);
    await new Promise((r) => setTimeout(r, 10));
    const second = await initProject(dir);
    expect(second.createdAt).toBe(first.createdAt);
  });
});

describe("pane registry", () => {
  test("upsert + list + setStatus round-trip", async () => {
    await initProject(dir);
    await upsertPaneRecord(dir, {
      id: "%5",
      task: "summarize readme",
      status: "idle",
      tmuxSession: "weave-test",
      tmuxPane: "%5",
      runFile: paths(dir).runFile("%5"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const before = await listPaneRecords(dir);
    expect(before).toHaveLength(1);
    expect(before[0]!.status).toBe("idle");

    await setPaneStatus(dir, "%5", "running");
    const after = await listPaneRecords(dir);
    expect(after[0]!.status).toBe("running");
  });
});

describe("runs", () => {
  test("readEvents on a missing file returns fileMissing", async () => {
    await initProject(dir);
    const r = await readEvents(dir, "%nope");
    expect(r.fileMissing).toBe(true);
    expect(r.events).toHaveLength(0);
  });

  test("readEvents + paneSummary on a populated run file", async () => {
    await initProject(dir);
    const runFile = paths(dir).runFile("%5");
    const jsonl = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"turn.started","turn_id":"u1"}',
      '{"type":"item.created","item_type":"agent_message","text":"hello"}',
      '{"type":"turn.completed","turn_id":"u1","usage":{"total_tokens":42}}',
    ].join("\n");
    await Bun.write(runFile, jsonl);

    const r = await readEvents(dir, "%5");
    expect(r.events).toHaveLength(4);
    expect(r.endByte).toBeGreaterThan(0);

    const s = await paneSummary(dir, "%5");
    expect(s.status).toBe("completed");
    expect(s.totalTokens).toBe(42);
    expect(s.lastMessage).toBe("hello");
  });

  test("readEvents respects sinceByte for incremental reads", async () => {
    await initProject(dir);
    const runFile = paths(dir).runFile("%5");
    await Bun.write(runFile, '{"type":"thread.started","thread_id":"t1"}\n');

    const first = await readEvents(dir, "%5");
    expect(first.events).toHaveLength(1);

    // Append more events
    const appended = '{"type":"turn.started","turn_id":"u2"}\n';
    const existing = await Bun.file(runFile).text();
    await Bun.write(runFile, existing + appended);

    const second = await readEvents(dir, "%5", { sinceByte: first.endByte });
    expect(second.events).toHaveLength(1);
    expect(second.events[0]!.type).toBe("turn.started");
  });
});
