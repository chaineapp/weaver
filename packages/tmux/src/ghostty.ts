// Ghostty integration. Keep this minimal: Weaver's programmable surface is
// tmux, not Ghostty.

export async function openGhostty(opts: { tmuxSession: string }): Promise<void> {
  // Two gotchas discovered the hard way:
  //   1. Ghostty wraps `-e` commands with `/usr/bin/login -flp <user>`, and
  //      login's PATH is minimal. So we need the absolute path to tmux.
  //   2. Ghostty's `-e` does NOT split its argument on whitespace. Everything
  //      after `-e` up to the next Ghostty flag is the command + args as
  //      separate argv entries. So we must pass tmux + attach + -t + session
  //      as FOUR separate `--args` entries. Quoting a whole command string
  //      would make login try to exec the literal space-separated string.
  const tmux = await resolveTmuxPath();
  const args = ["-na", "Ghostty", "--args", "-e", tmux, "attach", "-t", opts.tmuxSession];
  const proc = Bun.spawn(["open", ...args], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`failed to open Ghostty: ${stderr.trim()}`);
  }
}

async function resolveTmuxPath(): Promise<string> {
  const proc = Bun.spawn(["which", "tmux"], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const path = out.trim();
  if (!path) throw new Error("tmux not found in PATH — install with `brew install tmux`");
  return path;
}

export async function isGhosttyInstalled(): Promise<boolean> {
  const proc = Bun.spawn(["osascript", "-e", 'id of app "Ghostty"'], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return (await proc.exited) === 0;
}
