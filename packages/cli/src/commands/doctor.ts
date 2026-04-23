import { tmuxVersion, isGhosttyInstalled } from "@weaver/tmux";

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

async function commandExists(bin: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["which", bin], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    if (code !== 0) return null;
    return (await new Response(proc.stdout).text()).trim();
  } catch {
    return null;
  }
}

export async function runDoctor(): Promise<boolean> {
  const checks: Check[] = [];

  const tmux = await tmuxVersion();
  checks.push({ name: "tmux", ok: tmux !== null, detail: tmux ?? "not found — `brew install tmux`" });

  const ghostty = await isGhosttyInstalled();
  checks.push({
    name: "Ghostty",
    ok: ghostty,
    detail: ghostty ? "installed" : "not found — https://ghostty.org/",
  });

  const codex = await commandExists("codex");
  checks.push({
    name: "codex (OpenAI Codex CLI)",
    ok: codex !== null,
    detail: codex ?? "not found — install from https://developers.openai.com/codex/",
  });

  const claude = await commandExists("claude");
  checks.push({
    name: "claude (Claude Code CLI)",
    ok: claude !== null,
    detail: claude ?? "not found — install from https://claude.com/claude-code",
  });

  const bun = await commandExists("bun");
  checks.push({ name: "bun", ok: bun !== null, detail: bun ?? "not found — https://bun.sh" });

  console.log("weave doctor\n");
  let allOk = true;
  for (const c of checks) {
    const mark = c.ok ? "✓" : "✗";
    console.log(`  ${mark} ${c.name.padEnd(30)} ${c.detail}`);
    if (!c.ok) allOk = false;
  }
  console.log(`\n${allOk ? "all checks passed" : "some checks failed — see above"}`);
  return allOk;
}
