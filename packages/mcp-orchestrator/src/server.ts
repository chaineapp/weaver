import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { loadContext } from "./context.ts";
import {
  CurrentProjectInput,
  ListProjectsInput,
  NewProjectInput,
  RegisterRepoInput,
  CreateWorktreeInput,
  ListWorktreesInput,
  RemoveWorktreeInput,
  SpawnPaneInput,
  ListPanesInput,
  GetPaneOutputInput,
  SendToPaneInput,
  KillPaneInput,
  PaneSummaryInput,
  WaitForUpdatesInput,
  ListMemoriesInput,
  ReadMemoryInput,
  SearchMemoriesInput,
  RecentMemoriesInput,
  RememberInput,
  ForgetInput,
  currentProject,
  listProjectsTool,
  newProject,
  registerRepo,
  createWorktreeTool,
  listWorktrees,
  removeWorktreeTool,
  spawnPane,
  listPanesTool,
  getPaneOutput,
  sendToPane,
  killPaneTool,
  paneSummaryTool,
  waitForUpdatesTool,
  listMemoriesTool,
  readMemoryTool,
  searchMemoriesTool,
  recentMemoriesTool,
  rememberTool,
  forgetTool,
} from "./tools.ts";

const TOOLS = [
  {
    name: "current_project",
    description: "Return the current Weaver project this planner is bound to (via WEAVER_PROJECT_ID env), plus the workspace and its registered repos. Call this first to orient.",
    inputSchema: CurrentProjectInput,
    handler: currentProject,
  },
  {
    name: "list_projects",
    description: "List all projects in the current workspace.",
    inputSchema: ListProjectsInput,
    handler: listProjectsTool,
  },
  {
    name: "new_project",
    description: "Create a new project in the current workspace. Returns the project id. The user then runs `weave up --project <id>` to attach a planner.",
    inputSchema: NewProjectInput,
    handler: newProject,
  },
  {
    name: "register_repo",
    description: "Add a repo to the workspace config so it can be referenced by name in create_worktree.",
    inputSchema: RegisterRepoInput,
    handler: registerRepo,
  },
  {
    name: "create_worktree",
    description: "Create a git worktree on a registered repo under the current project. If the branch does not exist, it is created from base_branch (default 'main'). The worktree name is auto-derived as <repo>-<branch-slug>[-<linear_ticket>].",
    inputSchema: CreateWorktreeInput,
    handler: createWorktreeTool,
  },
  {
    name: "list_worktrees",
    description: "List worktrees on the current project.",
    inputSchema: ListWorktreesInput,
    handler: listWorktrees,
  },
  {
    name: "remove_worktree",
    description: "Remove a worktree from the current project (runs `git worktree remove --force`).",
    inputSchema: RemoveWorktreeInput,
    handler: removeWorktreeTool,
  },
  {
    name: "spawn_pane",
    description: "Spawn a Codex worker in a tmux pane, in one of the current project's worktrees. Output is tee'd to ~/.weave/runs/<pane>.jsonl.",
    inputSchema: SpawnPaneInput,
    handler: spawnPane,
  },
  {
    name: "list_panes",
    description: "List Codex worker panes (defaults to current project).",
    inputSchema: ListPanesInput,
    handler: listPanesTool,
  },
  {
    name: "get_pane_output",
    description: "Read new JSONL events from a pane. Auto-advances the review cursor.",
    inputSchema: GetPaneOutputInput,
    handler: getPaneOutput,
  },
  {
    name: "send_to_pane",
    description: "Inject text (plus Enter) into a pane.",
    inputSchema: SendToPaneInput,
    handler: sendToPane,
  },
  {
    name: "kill_pane",
    description: "Terminate a pane and remove it from the registry.",
    inputSchema: KillPaneInput,
    handler: killPaneTool,
  },
  {
    name: "pane_summary",
    description: "Cheap no-LLM summary of a pane.",
    inputSchema: PaneSummaryInput,
    handler: paneSummaryTool,
  },
  {
    name: "wait_for_updates",
    description: "Block until any pane emits new JSONL events past its review cursor, or timeout. THE planner's auto-loop primitive. Defaults to watching only panes in the current project.",
    inputSchema: WaitForUpdatesInput,
    handler: waitForUpdatesTool,
  },
  {
    name: "list_memories",
    description: "List memory files under ~/.weave/memory/. Filter by category or tag. Read these at session start to orient — they hold the user's standing preferences, architectural decisions, testing conventions, PR workflow rules.",
    inputSchema: ListMemoriesInput,
    handler: listMemoriesTool,
  },
  {
    name: "read_memory",
    description: "Read a specific memory file (path relative to ~/.weave/memory/).",
    inputSchema: ReadMemoryInput,
    handler: readMemoryTool,
  },
  {
    name: "search_memories",
    description: "Plain-text search across memory files. Use before you assume something — the user may have already stated a preference.",
    inputSchema: SearchMemoriesInput,
    handler: searchMemoriesTool,
  },
  {
    name: "recent_memories",
    description: "N most recently updated memories (default 10).",
    inputSchema: RecentMemoriesInput,
    handler: recentMemoriesTool,
  },
  {
    name: "remember",
    description: "Save a durable fact to ~/.weave/memory/<category>/<slug>.md. Call this IMMEDIATELY when the user states a preference, architectural decision, naming rule, testing convention, or workflow expectation that isn't tied to a single task — anything you'd otherwise need the user to repeat next session. Categories: architecture, patterns, testing, pr-behavior, runbooks, glossary, sessions.",
    inputSchema: RememberInput,
    handler: rememberTool,
  },
  {
    name: "forget",
    description: "Delete a memory file by path. Use when the user explicitly says to forget something, or a memory has been superseded.",
    inputSchema: ForgetInput,
    handler: forgetTool,
  },
] as const;

type ToolDef = (typeof TOOLS)[number];

export async function startMcpServer(opts: { serverCwd: string }): Promise<void> {
  const server = new Server({ name: "weaver", version: "0.3.0" }, { capabilities: { tools: {} } });

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
      return { isError: true, content: [{ type: "text", text: `unknown tool: ${req.params.name}` }] };
    }
    try {
      const ctx = await loadContext(opts.serverCwd);
      const parsed = tool.inputSchema.parse(req.params.arguments ?? {});
      const result = await (tool.handler as (c: typeof ctx, i: unknown) => Promise<unknown>)(ctx, parsed);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
    }
  });

  await server.connect(new StdioServerTransport());
}
