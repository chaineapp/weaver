import { initWeave, weavePaths } from "@weaver/core";
import { writeSeedPlaybooks } from "./seed.ts";
import { runFirstRunWizard } from "./wizard.ts";

export async function runInit(_opts: { force?: boolean }): Promise<void> {
  const p = weavePaths();
  const { firstRun } = await initWeave();
  await writeSeedPlaybooks(p.memoryDir);

  if (firstRun) {
    console.log(`✓ initialized ~/.weave/ (first run)`);
    await runFirstRunWizard();
  } else {
    console.log(`✓ ~/.weave/ already initialized`);
  }
  console.log(`  state:  ${p.weaveHome}`);
  console.log(`  memory: ${p.memoryDir}\n`);

  const registered = await registerMcp();
  if (registered.ok) {
    console.log(`✓ registered Weaver MCP server (${registered.scope} scope)`);
  } else {
    console.log(`! skipped MCP registration — ${registered.reason}`);
    console.log(`  run manually:  claude mcp add --scope user weaver -- weave mcp`);
  }

  console.log(`\nNext: \`cd\` into any repo, then \`weave up --panes 3\` — Weaver auto-registers the project.`);
}

async function registerMcp(): Promise<{ ok: true; scope: string } | { ok: false; reason: string }> {
  // Use `claude mcp add` in user scope so every Claude session everywhere sees Weaver's tools.
  // If already registered, the command is a no-op.
  try {
    const proc = Bun.spawn(
      ["claude", "mcp", "add", "--scope", "user", "weaver", "--", "weave", "mcp"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code === 0) return { ok: true, scope: "user" };
    // Already-exists is a success from the user's perspective.
    if (/already exists|already configured/i.test(stdout + stderr)) return { ok: true, scope: "user" };
    return { ok: false, reason: (stderr || stdout || "non-zero exit").trim().slice(0, 200) };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
