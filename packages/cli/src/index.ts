#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { runInit } from "./commands/init.ts";
import { runUp } from "./commands/up.ts";
import { runMcp } from "./commands/mcp.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runPanes } from "./commands/panes.ts";
import { runKill } from "./commands/kill.ts";

const HELP = `weave — coding agent orchestrator

Usage:
  weave init                    Initialize .weave/ and .mcp.json in the current project
  weave up [--panes N]          Open Ghostty with a tmux session, split into N panes (default 2)
  weave panes                   List Codex worker panes for this project
  weave kill <pane_id>          Kill a worker pane
  weave mcp                     Start the MCP stdio server (invoked by planner Claude)
  weave doctor                  Check required binaries are installed

Project root is the current working directory for every command (except mcp, which uses $PWD when invoked).`;

const [, , cmd, ...rest] = process.argv;

switch (cmd) {
  case undefined:
  case "-h":
  case "--help": {
    console.log(HELP);
    break;
  }
  case "init": {
    const { values } = parseArgs({
      args: rest,
      options: { force: { type: "boolean" } },
      strict: true,
    });
    await runInit({ force: values.force });
    break;
  }
  case "up": {
    const { values } = parseArgs({
      args: rest,
      options: { panes: { type: "string" } },
      strict: true,
    });
    const n = values.panes ? Number.parseInt(values.panes, 10) : 2;
    if (!Number.isFinite(n) || n < 1 || n > 6) {
      console.error(`--panes must be between 1 and 6 (got ${values.panes})`);
      process.exit(1);
    }
    await runUp({ panes: n });
    break;
  }
  case "panes": {
    await runPanes();
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
  default: {
    console.error(`unknown command: ${cmd}\n\n${HELP}`);
    process.exit(1);
  }
}
