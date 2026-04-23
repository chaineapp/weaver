import { describe, expect, test } from "bun:test";
import { parseEvent, parseAll, summarize } from "../src/index.ts";

describe("parseEvent", () => {
  test("parses thread.started", () => {
    const r = parseEvent('{"type":"thread.started","thread_id":"t1"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.type).toBe("thread.started");
  });

  test("rejects empty line", () => {
    const r = parseEvent("");
    expect(r.ok).toBe(false);
  });

  test("rejects non-JSON", () => {
    const r = parseEvent("not json");
    expect(r.ok).toBe(false);
  });

  test("rejects object without type field", () => {
    const r = parseEvent('{"foo":"bar"}');
    expect(r.ok).toBe(false);
  });

  test("preserves unknown event types via RawEvent fallback", () => {
    const r = parseEvent('{"type":"thread.ended","extra":42}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.event.type).toBe("thread.ended");
      expect((r.event as Record<string, unknown>).extra).toBe(42);
    }
  });
});

describe("parseAll", () => {
  test("skips empty lines and malformed rows", () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"t1"}',
      "",
      "garbage",
      '{"type":"turn.started","turn_id":"u1"}',
    ].join("\n");
    const events = parseAll(jsonl);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("thread.started");
    expect(events[1]!.type).toBe("turn.started");
  });
});

describe("summarize", () => {
  test("fresh stream is idle", () => {
    expect(summarize([]).status).toBe("idle");
  });

  test("thread.started → working", () => {
    const s = summarize([{ type: "thread.started", thread_id: "t1" }]);
    expect(s.status).toBe("working");
  });

  test("turn.completed → completed with token accumulation", () => {
    const s = summarize([
      { type: "turn.started", turn_id: "u1" },
      { type: "turn.completed", turn_id: "u1", usage: { total_tokens: 100 } },
      { type: "turn.started", turn_id: "u2" },
      { type: "turn.completed", turn_id: "u2", usage: { total_tokens: 50 } },
    ]);
    expect(s.status).toBe("completed");
    expect(s.turns).toBe(2);
    expect(s.totalTokens).toBe(150);
  });

  test("turn.failed → failed", () => {
    const s = summarize([
      { type: "turn.started", turn_id: "u1" },
      { type: "turn.failed", turn_id: "u1", error: "boom" },
    ]);
    expect(s.status).toBe("failed");
    expect(s.errorCount).toBe(1);
  });

  test("captures last command / file / message from items", () => {
    const s = summarize([
      { type: "item.created", item_type: "command_execution", command: "bun test" },
      { type: "item.created", item_type: "file_change", path: "src/foo.ts" },
      { type: "item.created", item_type: "agent_message", text: "done" },
    ]);
    expect(s.lastCommand).toBe("bun test");
    expect(s.lastFileChanged).toBe("src/foo.ts");
    expect(s.lastMessage).toBe("done");
  });
});
