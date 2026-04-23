// Compute a cheap, no-LLM summary from a stream of CodexEvents.
// Used by `pane_summary` MCP tool and `weave panes` TUI.

import type { CodexEvent } from "./events.ts";

export type PaneSummary = {
  status: "idle" | "working" | "completed" | "failed";
  turns: number;
  lastCommand?: string;
  lastFileChanged?: string;
  lastMessage?: string;
  errorCount: number;
  totalTokens: number;
  lastEventAt?: number; // epoch ms, if the stream carries timestamps (we don't track here; caller supplies)
};

export function summarize(events: CodexEvent[]): PaneSummary {
  const summary: PaneSummary = {
    status: "idle",
    turns: 0,
    errorCount: 0,
    totalTokens: 0,
  };

  for (const event of events) {
    switch (event.type) {
      case "thread.started":
        summary.status = "working";
        break;
      case "turn.started":
        summary.status = "working";
        summary.turns += 1;
        break;
      case "turn.completed": {
        summary.status = "completed";
        const usage = "usage" in event ? (event.usage as { total_tokens?: number } | undefined) : undefined;
        if (usage?.total_tokens) summary.totalTokens += usage.total_tokens;
        break;
      }
      case "turn.failed":
        summary.status = "failed";
        summary.errorCount += 1;
        break;
      case "error":
        summary.errorCount += 1;
        break;
      default:
        if (typeof event.type === "string" && event.type.startsWith("item.")) {
          const item = event as Record<string, unknown>;
          if (item.item_type === "command_execution" && typeof item.command === "string") {
            summary.lastCommand = item.command;
          }
          if (item.item_type === "file_change" && typeof item.path === "string") {
            summary.lastFileChanged = item.path;
          }
          if (item.item_type === "agent_message" && typeof item.text === "string") {
            summary.lastMessage = item.text.slice(0, 200);
          }
        }
    }
  }

  return summary;
}
