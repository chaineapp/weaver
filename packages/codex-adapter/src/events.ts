// Codex CLI JSONL event shapes, as emitted by `codex exec --json`.
// Reference: https://developers.openai.com/codex/noninteractive
// Intentionally permissive — Codex's event schema is not stable, so unknown
// fields are preserved and unknown `type` values fall through to RawEvent.

export type ThreadStarted = {
  type: "thread.started";
  thread_id: string;
};

export type TurnStarted = {
  type: "turn.started";
  turn_id: string;
};

export type TurnCompleted = {
  type: "turn.completed";
  turn_id: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export type TurnFailed = {
  type: "turn.failed";
  turn_id: string;
  error: string;
};

export type ItemType =
  | "agent_message"
  | "reasoning"
  | "command_execution"
  | "file_change"
  | "mcp_tool_call"
  | "mcp_tool_result";

export type Item = {
  type: `item.${string}`;
  item_type: ItemType | string;
  turn_id?: string;
  text?: string;
  command?: string;
  path?: string;
  diff?: string;
  tool_name?: string;
  input?: unknown;
  output?: unknown;
};

export type ErrorEvent = {
  type: "error";
  message: string;
};

export type RawEvent = {
  type: string;
  [key: string]: unknown;
};

export type CodexEvent =
  | ThreadStarted
  | TurnStarted
  | TurnCompleted
  | TurnFailed
  | Item
  | ErrorEvent
  | RawEvent;

export type ParseResult =
  | { ok: true; event: CodexEvent }
  | { ok: false; line: string; error: string };

export function parseEvent(line: string): ParseResult {
  const trimmed = line.trim();
  if (!trimmed) return { ok: false, line, error: "empty line" };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
      return { ok: false, line, error: "no type field" };
    }
    return { ok: true, event: parsed as CodexEvent };
  } catch (err) {
    return { ok: false, line, error: (err as Error).message };
  }
}

export function parseAll(jsonl: string): CodexEvent[] {
  const events: CodexEvent[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const result = parseEvent(line);
    if (result.ok) events.push(result.event);
  }
  return events;
}
