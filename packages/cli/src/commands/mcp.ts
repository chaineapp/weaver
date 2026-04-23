import { startMcpServer } from "@weaver/mcp-orchestrator";

export async function runMcp(): Promise<void> {
  // projectRoot is the cwd where Claude Code invoked `weave mcp`, which for a
  // project-scoped .mcp.json is the project root.
  await startMcpServer({ projectRoot: process.cwd() });
}
