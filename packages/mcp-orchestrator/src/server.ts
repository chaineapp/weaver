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
  ListProjectsInput,
  WaitForUpdatesInput,
  spawnPane,
  listPanesTool,
  getPaneOutput,
  sendToPane,
  killPaneTool,
  paneSummaryTool,
  listProjectsTool,
  waitForUpdatesTool,
} from "./tools.ts";

const TOOLS = [
  {
    name: "spawn_pane",
    description:
      "Spawn a new Codex worker in a tmux pane. Project+worktree are auto-resolved from cwd (defaults to planner's cwd). The pane's stdout is captured to ~/.weave/runs/<pane>.jsonl — you read it via get_pane_output.",
    inputSchema: SpawnPaneInput,
    handler: spawnPane,
  },
  {
    name: "list_panes",
    description:
      "List Codex worker panes. No filter returns all panes across all projects and worktrees. Shows status, task, last command/file/message, review cursor.",
    inputSchema: ListPanesInput,
    handler: listPanesTool,
  },
  {
    name: "get_pane_output",
    description:
      "Read new JSONL events from a worker pane and auto-advance the review cursor. Subsequent calls return only events you haven't seen. Pass from_start=true to replay everything.",
    inputSchema: GetPaneOutputInput,
    handler: getPaneOutput,
  },
  {
    name: "send_to_pane",
    description: "Inject input (plus Enter) into a worker pane via tmux send-keys.",
    inputSchema: SendToPaneInput,
    handler: sendToPane,
  },
  {
    name: "kill_pane",
    description: "Terminate a worker pane and remove it from the registry.",
    inputSchema: KillPaneInput,
    handler: killPaneTool,
  },
  {
    name: "pane_summary",
    description:
      "Return a cheap, no-LLM summary of a pane: status, turns, last command/file/message, token totals, error count.",
    inputSchema: PaneSummaryInput,
    handler: paneSummaryTool,
  },
  {
    name: "list_projects",
    description: "List all projects and their worktrees that Weaver has registered.",
    inputSchema: ListProjectsInput,
    handler: listProjectsTool,
  },
  {
    name: "wait_for_updates",
    description:
      "Block until any pane emits new JSONL events past its review cursor, or the timeout fires. Returns the list of changed panes with byte deltas. THIS IS THE PLANNER'S AUTO-LOOP PRIMITIVE — call it after spawn_pane and again after each read, so workers' results flow back without the user re-prompting.",
    inputSchema: WaitForUpdatesInput,
    handler: waitForUpdatesTool,
  },
] as const;

type ToolDef = (typeof TOOLS)[number];

export async function startMcpServer(opts: { serverCwd: string }): Promise<void> {
  const server = new Server(
    { name: "weaver", version: "0.2.0" },
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
      const result = await (tool.handler as (cwd: string, input: unknown) => Promise<unknown>)(
        opts.serverCwd,
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
