#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { runInit } from "./commands/init.ts";
import { runUp } from "./commands/up.ts";
import { runMcp } from "./commands/mcp.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runPanes } from "./commands/panes.ts";
import { runKill } from "./commands/kill.ts";
import { runWorkspaceInit, runRepoAdd, runRepoList } from "./commands/workspace.ts";
import { runProjectNew, runProjectList, runProjectRemove } from "./commands/project.ts";
import { runClean } from "./commands/clean.ts";

const HELP = `weave — coding agent orchestrator

One-time setup:
  weave init                          create ~/.weave/ and register MCP globally
  weave workspace init [PATH]         mark a code dir (default cwd) as a workspace
  weave repo add NAME PATH [--role R] register a repo in the current workspace

Project lifecycle (a project spans 1..N repos via git worktrees):
  weave new [--name X] [--linear CHA-123]   create a project
  weave list                                list projects in current workspace
  weave up [--project ID] [--panes N]       open Ghostty with planner bound to project
  weave remove ID [--worktrees]             delete project (optionally drop worktrees)

Inspection:
  weave repos                         list registered repos
  weave panes [--project ID]          list Codex worker panes
  weave kill <pane_id>                kill a worker pane
  weave clean                         wipe all panes, run files, weave-* tmux sessions

Internal (invoked by Claude Code):
  weave mcp                           start the MCP stdio server
  weave doctor                        check required binaries
`;

const [, , cmd, ...rest] = process.argv;

async function main() {
  switch (cmd) {
    case undefined:
    case "-h":
    case "--help":
      console.log(HELP);
      return;

    case "init": {
      const { values } = parseArgs({ args: rest, options: { force: { type: "boolean" } }, strict: true });
      await runInit({ force: values.force });
      return;
    }

    case "workspace": {
      const sub = rest[0];
      if (sub === "init") {
        await runWorkspaceInit({ path: rest[1] });
        return;
      }
      console.error("usage: weave workspace init [PATH]");
      process.exit(1);
    }

    case "repo": {
      const sub = rest[0];
      if (sub === "add") {
        const name = rest[1];
        const path = rest[2];
        if (!name || !path) {
          console.error("usage: weave repo add NAME PATH [--role ROLE]");
          process.exit(1);
        }
        const { values } = parseArgs({ args: rest.slice(3), options: { role: { type: "string" } }, strict: true });
        await runRepoAdd({ name, path, role: values.role });
        return;
      }
      console.error("usage: weave repo add NAME PATH [--role ROLE]");
      process.exit(1);
    }

    case "repos": {
      await runRepoList();
      return;
    }

    case "new": {
      const { values } = parseArgs({
        args: rest,
        options: { name: { type: "string" }, linear: { type: "string" } },
        strict: true,
      });
      await runProjectNew({ name: values.name, linear: values.linear });
      return;
    }

    case "list": {
      await runProjectList();
      return;
    }

    case "remove": {
      const id = rest[0];
      if (!id) {
        console.error("usage: weave remove PROJECT_ID [--worktrees]");
        process.exit(1);
      }
      const { values } = parseArgs({
        args: rest.slice(1),
        options: { worktrees: { type: "boolean" } },
        strict: true,
      });
      await runProjectRemove({ id, removeWorktrees: values.worktrees });
      return;
    }

    case "up": {
      const { values } = parseArgs({
        args: rest,
        options: { project: { type: "string" }, panes: { type: "string" } },
        strict: true,
      });
      const n = values.panes ? Number.parseInt(values.panes, 10) : 2;
      if (!Number.isFinite(n) || n < 1 || n > 6) {
        console.error(`--panes must be 1..6 (got ${values.panes})`);
        process.exit(1);
      }
      await runUp({ project: values.project, panes: n });
      return;
    }

    case "panes": {
      const { values } = parseArgs({
        args: rest,
        options: { project: { type: "string" } },
        strict: true,
      });
      await runPanes({ project: values.project });
      return;
    }

    case "kill": {
      const paneId = rest[0];
      if (!paneId) {
        console.error("usage: weave kill <pane_id>");
        process.exit(1);
      }
      await runKill({ paneId });
      return;
    }

    case "mcp":
      await runMcp();
      return;

    case "clean":
      await runClean();
      return;

    case "doctor": {
      const ok = await runDoctor();
      process.exit(ok ? 0 : 1);
    }

    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
}

await main();
