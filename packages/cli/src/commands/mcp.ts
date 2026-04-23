import { startMcpServer } from "@weaver/mcp-orchestrator";

export async function runMcp(): Promise<void> {
  // The server's cwd is whatever Claude Code launched us in — i.e. the planner's
  // project root for project-scoped use, or anywhere for user-scoped use.
  await startMcpServer({ serverCwd: process.cwd() });
}
