#!/usr/bin/env bun
// Standalone binary entrypoint. Prefer running via `weave mcp` (which calls
// startMcpServer with the project root); this exists for direct invocation.

import { startMcpServer } from "./server.ts";

await startMcpServer({ projectRoot: process.cwd() });
