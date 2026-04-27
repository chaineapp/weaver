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
import { runConfigGet, runConfigSet, runConfigList, configUsage } from "./commands/config.ts";
import { runVersion, maybeNotifyUpdate } from "./commands/version.ts";
import { runRestartPlanner } from "./commands/restart.ts";
import { runDispatch } from "./commands/dispatch.ts";
import { runDispatchBatch } from "./commands/dispatch-batch.ts";
import { runTail } from "./commands/tail.ts";

const HELP = `weave — coding agent orchestrator

ONE-TIME SETUP
  weave init                          create ~/.weave/, register MCP, run preferences wizard
  weave workspace init [PATH]         mark a code dir (default cwd) as a workspace
  weave repo add NAME PATH [--role R] register a repo in the current workspace

PROJECT LIFECYCLE (a project spans 1..N repos via git worktrees)
  weave new                                     interactive: prompt for name + linear, auto-launch
  weave new --name X [--linear Y] [--planner BIN] [--no-up]
                                                non-interactive create. --planner = claude|codex (default: from config)
  weave list                                    list projects in current workspace
  weave up [--project ID] [--panes N] [--bypass]
                                                open Ghostty: planner left, N workers in a grid (N: 1-6)
                                                --bypass — claude --dangerously-skip-permissions
                                                           (also: WEAVER_CLAUDE_BYPASS=1 env, or planner.bypass config)
  weave restart-planner [--project ID] [--bypass|--no-bypass] [--model M]
                                                respawn pane 0 with new flags, resume the claude
                                                session so conversation context is preserved
  weave remove ID [--worktrees]                 delete project (optionally drop worktrees)

CONFIG (defaults read by every weave up / spawn_pane)
  weave config list                             show all keys + current values
  weave config get KEY                          print one value
  weave config set KEY VALUE                    persist a default
                                                keys: planner.bypass, planner.model, planner.extraArgs,
                                                      worker.bypass, worker.model, worker.extraArgs,
                                                      defaultPanes, defaultWaitTimeoutSeconds

DISPATCH (Bash-driven worker control — see CHA-1012)
  weave dispatch worker-N "<task>"    fire a task at a worker pane (parallel-safe)
                                      [--binary X] [--model Y] [--bypass] [--cwd PATH]
                                      --cwd: cd the pane there first (use for worktrees)
  weave tail worker-N [--follow] [--wait-done]
                                      stream a worker's run file, optionally
                                      block until codex emits a turn-complete event

INSPECTION
  weave repos                         list registered repos
  weave panes [--project ID]          list worker panes (worker-1..N + status)
  weave kill <pane_id>                kill a worker pane
  weave clean [--close-windows]       wipe all panes, run files, weave-* tmux sessions
                                      --close-windows: also kill orphan tmux clients
                                      so Ghostty tabs close when sessions are dead
  weave version                       current version + check GitHub for updates

INTERNAL
  weave mcp                           start the MCP stdio server (invoked by Claude Code)
  weave doctor                        check required binaries
  weave migrate <path>                clean up legacy v0.1 per-project .weave/
`;

const [, , cmd, ...rest] = process.argv;

async function main() {
  // Best-effort update check on every user-facing command. Silent on network
  // failure. Skipped for internal subcommands where output would pollute
  // machine-consumed stdout.
  if (cmd && !["mcp", "doctor", "-v", "--version", "version"].includes(cmd)) {
    await maybeNotifyUpdate();
  }

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
        options: {
          name: { type: "string" },
          linear: { type: "string" },
          planner: { type: "string" },  // "claude" | "codex" | other
          "no-up": { type: "boolean" },
        },
        strict: true,
      });
      // No --name → interactive prompt + auto-launch (matches the
      // "Cmd+T → answer two questions → start coding" flow).
      await runProjectNew({
        name: values.name,
        linear: values.linear,
        plannerBinary: values.planner,
        thenUp: values["no-up"] ? false : undefined,
      });
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
      let values: {
        project?: string;
        panes?: string;
        bypass?: boolean;
      };
      try {
        values = parseArgs({
          args: rest,
          options: {
            project: { type: "string" },
            panes: { type: "string" },
            bypass: { type: "boolean" },
          },
          strict: true,
        }).values as typeof values;
      } catch (err) {
        console.error(`error: ${(err as Error).message}`);
        console.error(`usage: weave up [--project ID] [--panes N (1..6)] [--bypass]`);
        process.exit(1);
      }

      // If --panes isn't passed, fall back to config.defaultPanes, then 4.
      let n: number;
      if (values.panes !== undefined) {
        n = Number.parseInt(values.panes, 10);
      } else {
        const { readConfig } = await import("@weaver/core");
        const cfg = await readConfig();
        n = cfg?.defaultPanes ?? 4;
      }
      if (!Number.isFinite(n) || n < 1 || n > 6) {
        console.error(`--panes must be 1..6 (got ${values.panes ?? n})`);
        process.exit(1);
      }
      await runUp({ project: values.project, panes: n, bypass: values.bypass });
      return;
    }

    case "dispatch": {
      // weave dispatch <worker> <task...>
      // Example: weave dispatch worker-1 "what is 1+1, reply with just the number"
      // The task can be the rest of argv joined with spaces (no need to quote
      // for the user, but quoting works too).
      let values: { binary?: string; model?: string; bypass?: boolean; cwd?: string };
      let positionals: string[];
      try {
        const parsed = parseArgs({
          args: rest,
          options: {
            binary: { type: "string" },
            model: { type: "string" },
            bypass: { type: "boolean" },
            cwd: { type: "string" },
          },
          strict: true,
          allowPositionals: true,
        });
        values = parsed.values as typeof values;
        positionals = parsed.positionals;
      } catch (err) {
        console.error(`error: ${(err as Error).message}`);
        console.error(`usage: weave dispatch <worker-N | %paneid> <task...> [--binary X] [--model Y] [--bypass] [--cwd PATH]`);
        process.exit(1);
      }
      const [worker, ...taskParts] = positionals;
      const task = taskParts.join(" ").trim();
      if (!worker || !task) {
        console.error("usage: weave dispatch <worker-N | %paneid> <task...> [--binary X] [--model Y] [--bypass] [--cwd PATH]");
        process.exit(1);
      }
      await runDispatch({ worker, task, binary: values.binary, model: values.model, bypass: values.bypass, cwd: values.cwd });
      return;
    }

    case "dispatch-batch": {
      // weave dispatch-batch '<json>' [--binary X] [--bypass] [--cwd PATH]
      // JSON: {"worker-1": "task" | {"task": "...", "binary": "codex", ...}, ...}
      // Used by /weaver:dispatch-batch subagent so it makes only ONE Bash call.
      let values: { binary?: string; bypass?: boolean; model?: string; cwd?: string };
      let positionals: string[];
      try {
        const parsed = parseArgs({
          args: rest,
          options: {
            binary: { type: "string" },
            bypass: { type: "boolean" },
            model: { type: "string" },
            cwd: { type: "string" },
          },
          strict: true,
          allowPositionals: true,
        });
        values = parsed.values as typeof values;
        positionals = parsed.positionals;
      } catch (err) {
        console.error(`error: ${(err as Error).message}`);
        console.error(`usage: weave dispatch-batch '<json>' [--binary X] [--bypass] [--cwd PATH]`);
        process.exit(1);
      }
      const json = positionals[0];
      if (!json) {
        console.error(`usage: weave dispatch-batch '<json>' [--binary X] [--bypass] [--cwd PATH]`);
        console.error(`example: weave dispatch-batch '{"worker-1":"task A","worker-2":"task B"}'`);
        process.exit(1);
      }
      await runDispatchBatch({ json, binary: values.binary, bypass: values.bypass, model: values.model, cwd: values.cwd });
      return;
    }

    case "tail": {
      let values: { follow?: boolean; "wait-done"?: boolean; since?: string };
      let positionals: string[];
      try {
        const parsed = parseArgs({
          args: rest,
          options: {
            follow: { type: "boolean" },
            "wait-done": { type: "boolean" },
            since: { type: "string" },
          },
          strict: true,
          allowPositionals: true,
        });
        values = parsed.values as typeof values;
        positionals = parsed.positionals;
      } catch (err) {
        console.error(`error: ${(err as Error).message}`);
        console.error(`usage: weave tail <worker-N | %paneid> [--follow] [--wait-done] [--since BYTE]`);
        process.exit(1);
      }
      const worker = positionals[0];
      if (!worker) {
        console.error("usage: weave tail <worker-N | %paneid> [--follow] [--wait-done] [--since BYTE]");
        process.exit(1);
      }
      await runTail({
        worker,
        follow: values.follow,
        waitDone: values["wait-done"],
        since: values.since ? Number.parseInt(values.since, 10) : undefined,
      });
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

    case "clean": {
      const { values } = parseArgs({
        args: rest,
        options: { "close-windows": { type: "boolean" } },
        strict: true,
      });
      await runClean({ closeWindows: values["close-windows"] });
      return;
    }

    case "config": {
      const sub = rest[0];
      if (sub === "list") {
        await runConfigList();
        return;
      }
      if (sub === "get") {
        const key = rest[1];
        if (!key) {
          console.error("usage: weave config get <key>");
          process.exit(1);
        }
        await runConfigGet(key);
        return;
      }
      if (sub === "set") {
        const key = rest[1];
        const value = rest.slice(2).join(" ");
        if (!key || !value) {
          console.error("usage: weave config set <key> <value>");
          process.exit(1);
        }
        await runConfigSet(key, value);
        return;
      }
      console.error(configUsage());
      process.exit(1);
    }

    case "version":
    case "--version":
    case "-v":
      await runVersion();
      return;

    case "restart-planner": {
      const { values } = parseArgs({
        args: rest,
        options: {
          project: { type: "string" },
          bypass: { type: "boolean" },
          "no-bypass": { type: "boolean" },
          model: { type: "string" },
        },
        strict: true,
      });
      await runRestartPlanner({
        project: values.project,
        bypass: values.bypass,
        noBypass: values["no-bypass"],
        model: values.model,
      });
      return;
    }

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
