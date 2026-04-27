import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "weaver-cfg-"));
  process.env.HOME = home;
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("buildPlannerCommand", () => {
  test("default is plain claude", async () => {
    const { buildPlannerCommand } = await import("../src/commands/up.ts");
    expect(buildPlannerCommand()).toBe("claude");
  });

  test("bypass adds --dangerously-skip-permissions", async () => {
    const { buildPlannerCommand } = await import("../src/commands/up.ts");
    expect(buildPlannerCommand({ bypass: true })).toBe("claude --dangerously-skip-permissions");
  });

  test("model adds --model flag", async () => {
    const { buildPlannerCommand } = await import("../src/commands/up.ts");
    expect(buildPlannerCommand({ model: "claude-opus-4-7" })).toBe("claude --model claude-opus-4-7");
  });

  test("bypass + model combined", async () => {
    const { buildPlannerCommand } = await import("../src/commands/up.ts");
    expect(buildPlannerCommand({ bypass: true, model: "claude-opus-4-7" })).toBe(
      "claude --dangerously-skip-permissions --model claude-opus-4-7",
    );
  });
});

describe("buildCodexCommand", () => {
  // Default mode is interactive — workers run the real codex/claude TUI
  // in their tmux pane so the user can watch thoughts/actions live.
  // --no-alt-screen keeps everything inline with tmux scrollback.
  // --full-auto = sandboxed auto-approve (safe default).
  // --dangerously-bypass-approvals-and-sandbox = full bypass (when bypass=true).
  // --skip-git-repo-check is always on because Weaver dispatches into
  // project dirs that often aren't git repos.
  test("interactive default: --no-alt-screen --skip-git-repo-check --full-auto", async () => {
    const { buildCodexCommand } = await import("../../mcp-orchestrator/src/spawn.ts");
    expect(buildCodexCommand("review x")).toBe("codex --no-alt-screen --skip-git-repo-check --full-auto 'review x'");
  });

  test("interactive + bypass swaps --full-auto for --dangerously-bypass-approvals-and-sandbox", async () => {
    const { buildCodexCommand } = await import("../../mcp-orchestrator/src/spawn.ts");
    expect(buildCodexCommand("x", { bypass: true })).toBe(
      "codex --no-alt-screen --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox 'x'",
    );
  });

  test("interactive + bypass + model", async () => {
    const { buildCodexCommand } = await import("../../mcp-orchestrator/src/spawn.ts");
    expect(
      buildCodexCommand("x", { bypass: true, model: "gpt-5-codex-high" }),
    ).toBe("codex --no-alt-screen --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --model 'gpt-5-codex-high' 'x'");
  });

  test("non-interactive mode (interactive: false) keeps the codex exec --json path", async () => {
    const { buildCodexCommand } = await import("../../mcp-orchestrator/src/spawn.ts");
    expect(buildCodexCommand("x", { interactive: false })).toBe("codex exec --json --skip-git-repo-check 'x'");
  });
});

describe("config round-trip", () => {
  test("set + get persists across readConfig", async () => {
    const { runConfigSet } = await import("../src/commands/config.ts");
    const { initWeave, readConfig } = await import("@weaver/core");
    await initWeave();

    await runConfigSet("planner.bypass", "true");
    await runConfigSet("worker.bypass", "true");
    await runConfigSet("worker.model", "gpt-5-codex-high");
    await runConfigSet("defaultPanes", "4");

    const cfg = await readConfig();
    expect(cfg?.planner?.bypass).toBe(true);
    expect(cfg?.worker?.bypass).toBe(true);
    expect(cfg?.worker?.model).toBe("gpt-5-codex-high");
    expect(cfg?.defaultPanes).toBe(4);
  });

  test("bypass parses true/false/on/off/yes/no", async () => {
    const { parseConfigValue } = await import("@weaver/core");
    expect(parseConfigValue("planner.bypass", "true")).toBe(true);
    expect(parseConfigValue("planner.bypass", "on")).toBe(true);
    expect(parseConfigValue("planner.bypass", "yes")).toBe(true);
    expect(parseConfigValue("planner.bypass", "false")).toBe(false);
    expect(parseConfigValue("planner.bypass", "off")).toBe(false);
    expect(parseConfigValue("planner.bypass", "no")).toBe(false);
    expect(() => parseConfigValue("planner.bypass", "maybe")).toThrow();
  });
});
