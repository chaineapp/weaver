#!/usr/bin/env bun
import { startMcpServer } from "./server.ts";
await startMcpServer({ serverCwd: process.cwd() });
