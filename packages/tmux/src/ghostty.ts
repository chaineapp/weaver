// Ghostty integration. Keep this minimal: Weaver's programmable surface is
// tmux, not Ghostty. Ghostty is just the visible terminal that attaches to a
// tmux session.

export async function openGhostty(opts: { tmuxSession: string }): Promise<void> {
  // macOS: Ghostty wraps the `-e` command with `/usr/bin/login -flp <user>`,
  // and login's PATH is minimal (`/usr/bin:/bin:/usr/sbin:/sbin`). Homebrew's
  // tmux lives at /usr/local/bin or /opt/homebrew/bin, which login cannot see.
  // Resolve the absolute path of tmux here so login can exec it directly.
  const tmux = await resolveTmuxPath();
  const attachCmd = `${tmux} attach -t ${shellQuote(opts.tmuxSession)}`;
  const args = ["-na", "Ghostty", "--args", "-e", attachCmd];
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

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
