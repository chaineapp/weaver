// MCP stdio server. Exposes Weaver's orchestration surface to any MCP client
// (primarily the planner Claude session). Self-contained: reads `.weave/` files
// and drives `tmux` directly, no daemon in v1.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  SpawnPaneInput,
  ListPanesInput,
  GetPaneOutputInput,
  SendToPaneInput,
  KillPaneInput,
  PaneSummaryInput,
  spawnPane,
  listPanes,
  getPaneOutput,
  sendToPane,
  killPaneTool,
  paneSummaryTool,
} from "./tools.ts";

const TOOLS = [
  {
    name: "spawn_pane",
    description:
      "Spawn a new Codex worker in a tmux pane under the current Weaver project. Returns the pane id the planner can use to monitor and drive it.",
    inputSchema: SpawnPaneInput,
    handler: spawnPane,
  },
  {
    name: "list_panes",
    description:
      "List all Codex worker panes in the current project with status, task, and recent activity.",
    inputSchema: ListPanesInput,
    handler: listPanes,
  },
  {
    name: "get_pane_output",
    description:
      "Read structured JSONL events emitted by a Codex worker pane. Supports incremental reads via since_byte.",
    inputSchema: GetPaneOutputInput,
    handler: getPaneOutput,
  },
  {
    name: "send_to_pane",
    description: "Inject input (followed by Enter) into a Codex worker pane via tmux send-keys.",
    inputSchema: SendToPaneInput,
    handler: sendToPane,
  },
  {
    name: "kill_pane",
    description: "Terminate a Codex worker pane and remove it from the registry.",
    inputSchema: KillPaneInput,
    handler: killPaneTool,
  },
  {
    name: "pane_summary",
    description:
      "Return a cheap, no-LLM summary of a pane's state: status, turns, last command/file/message, token totals, error count.",
    inputSchema: PaneSummaryInput,
    handler: paneSummaryTool,
  },
] as const;

type ToolDef = (typeof TOOLS)[number];

export async function startMcpServer(opts: { projectRoot: string }): Promise<void> {
  const server = new Server(
    { name: "weaver", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema as unknown as Parameters<typeof zodToJsonSchema>[0]),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name) as ToolDef | undefined;
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `unknown tool: ${req.params.name}` }],
      };
    }
    try {
      const parsed = tool.inputSchema.parse(req.params.arguments ?? {});
      // The tool handlers are narrowly typed per tool; the dispatch layer erases
      // that relationship, so we cast here.
      const result = await (tool.handler as (root: string, input: unknown) => Promise<unknown>)(
        opts.projectRoot,
        parsed,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: (err as Error).message }],
      };
    }
  });

  await server.connect(new StdioServerTransport());
}
