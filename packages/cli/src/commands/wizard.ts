import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readConfig, writeConfig, defaultConfig, setConfigValue, type WeaveConfig } from "@weaver/core";

// First-run wizard, invoked from `weave init` when the user has no config yet.
// Interactive only — skipped under non-TTY (CI, scripted install).

export async function runFirstRunWizard(): Promise<void> {
  if (!stdin.isTTY) return;

  const existing = await readConfig();
  const cfg: WeaveConfig = existing ?? defaultConfig();

  console.log("");
  console.log("Weaver defaults — answer once, change later with `weave config set`.");
  console.log("(press Enter to accept the default)");
  console.log("");

  const rl = createInterface({ input: stdin, output: stdout });

  async function ask(prompt: string, def: string): Promise<string> {
    const answer = await rl.question(`  ${prompt} [${def}]: `);
    return answer.trim() || def;
  }

  async function askBool(prompt: string, def: boolean): Promise<boolean> {
    const answer = (await rl.question(`  ${prompt} [${def ? "Y/n" : "y/N"}]: `)).trim().toLowerCase();
    if (!answer) return def;
    return answer === "y" || answer === "yes" || answer === "true" || answer === "on";
  }

  try {
    console.log("-- planner agent (the Claude running in pane 0) --");
    const plannerBinary = await ask("planner: agent binary (e.g. claude, gemini)", "claude");
    const plannerBypass = await askBool(
      plannerBinary === "claude"
        ? "planner: launch with --dangerously-skip-permissions?"
        : "planner: add a permission-skip flag via extraArgs later?",
      true,
    );
    const plannerModel = await ask("planner: default model (blank = CLI default)", "");

    console.log("\n-- worker agent (codex spawned into tmux panes) --");
    const workerBinary = await ask("worker: agent binary (e.g. codex, aider)", "codex");
    const workerBypass = await askBool(
      workerBinary === "codex"
        ? "worker: launch with --dangerously-bypass-approvals-and-sandbox?"
        : "worker: add a permission-skip flag via extraArgs later?",
      true,
    );
    const workerModel = await ask("worker: default model (blank = CLI default)", "gpt-5-codex");

    console.log("\n-- misc --");
    const defaultPanes = Number.parseInt(await ask("default number of worker panes", "4"), 10) || 4;

    let next = cfg;
    if (plannerBinary && plannerBinary !== "claude") next = setConfigValue(next, "planner.binary", plannerBinary);
    next = setConfigValue(next, "planner.bypass", plannerBypass);
    if (plannerModel) next = setConfigValue(next, "planner.model", plannerModel);
    if (workerBinary && workerBinary !== "codex") next = setConfigValue(next, "worker.binary", workerBinary);
    next = setConfigValue(next, "worker.bypass", workerBypass);
    if (workerModel) next = setConfigValue(next, "worker.model", workerModel);
    next = setConfigValue(next, "defaultPanes", defaultPanes);

    await writeConfig(next);
    console.log("");
    console.log("✓ preferences saved to ~/.weave/config.json");
    console.log("  change any time: `weave config set <key> <value>` — see `weave config list`");
  } finally {
    rl.close();
  }
}
