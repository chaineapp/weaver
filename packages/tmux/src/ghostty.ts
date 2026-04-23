// Ghostty integration. We keep this small: Weaver's programmable surface is
// tmux, not AppleScript. Ghostty is just the visible terminal window that
// attaches to a tmux session.

export async function openGhostty(opts: { tmuxSession: string; cwd?: string }): Promise<void> {
  // macOS: `open -na Ghostty --args -e "tmux attach -t <session>"`.
  // Ghostty's `-e` flag executes the command in a new window.
  const attachCmd = `tmux attach -t ${shellQuote(opts.tmuxSession)}`;
  const args = ["-na", "Ghostty", "--args", "-e", attachCmd];
  if (opts.cwd) {
    // Ghostty's working-directory flag
    args.push("--working-directory", opts.cwd);
  }
  const proc = Bun.spawn(["open", ...args], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`failed to open Ghostty: ${stderr.trim()}`);
  }
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
