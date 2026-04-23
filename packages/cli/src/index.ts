#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { runInit } from "./commands/init.ts";
import { runUp } from "./commands/up.ts";
import { runMcp } from "./commands/mcp.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runPanes } from "./commands/panes.ts";
import { runProjects } from "./commands/projects.ts";
import { runKill } from "./commands/kill.ts";
import { runMigrate } from "./commands/migrate.ts";

const HELP = `weave — coding agent orchestrator

Usage:
  weave init                         One-time: create ~/.weave/ and register MCP server globally
  weave up [--path DIR] [--panes N]  Open Ghostty for a project (cwd or --path). Auto-registers.
  weave projects                     List registered projects and worktrees
  weave panes [--project X]          List Codex worker panes (optionally filtered)
  weave kill <pane_id>               Kill a worker pane
  weave mcp                          Start the MCP stdio server (Claude Code launches this)
  weave doctor                       Check required binaries
  weave migrate <path>               Remove legacy per-project .weave/ and .mcp.json (v0.1 cleanup)
`;

const [, , cmd, ...rest] = process.argv;

switch (cmd) {
  case undefined:
  case "-h":
  case "--help": {
    console.log(HELP);
    break;
  }
  case "init": {
    const { values } = parseArgs({ args: rest, options: { force: { type: "boolean" } }, strict: true });
    await runInit({ force: values.force });
    break;
  }
  case "up": {
    const { values } = parseArgs({
      args: rest,
      options: { panes: { type: "string" }, path: { type: "string" } },
      strict: true,
    });
    const n = values.panes ? Number.parseInt(values.panes, 10) : 2;
    if (!Number.isFinite(n) || n < 1 || n > 6) {
      console.error(`--panes must be between 1 and 6 (got ${values.panes})`);
      process.exit(1);
    }
    await runUp({ panes: n, path: values.path });
    break;
  }
  case "projects": {
    await runProjects();
    break;
  }
  case "panes": {
    const { values } = parseArgs({
      args: rest,
      options: { project: { type: "string" }, worktree: { type: "string" } },
      strict: true,
    });
    await runPanes({ project: values.project, worktree: values.worktree });
    break;
  }
  case "kill": {
    const paneId = rest[0];
    if (!paneId) {
      console.error("usage: weave kill <pane_id>");
      process.exit(1);
    }
    await runKill({ paneId });
    break;
  }
  case "mcp": {
    await runMcp();
    break;
  }
  case "doctor": {
    const ok = await runDoctor();
    process.exit(ok ? 0 : 1);
  }
  case "migrate": {
    const path = rest[0];
    if (!path) {
      console.error("usage: weave migrate <path-to-old-project>");
      process.exit(1);
    }
    await runMigrate({ path: resolve(path) });
    break;
  }
  default: {
    console.error(`unknown command: ${cmd}\n\n${HELP}`);
    process.exit(1);
  }
}
