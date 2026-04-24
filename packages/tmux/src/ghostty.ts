// Ghostty integration. Keep this minimal: Weaver's programmable surface is
// tmux, not Ghostty. Ghostty is just the visible terminal that attaches to a
// tmux session.

export async function openGhostty(opts: { tmuxSession: string }): Promise<void> {
  // macOS: `open -na Ghostty --args -e "tmux attach -t <session>"`.
  // Do NOT pass --working-directory after -e — Ghostty's arg parser consumes
  // everything after -e as part of the command, so late flags end up appended
  // to the tmux invocation.
  const attachCmd = `tmux attach -t ${shellQuote(opts.tmuxSession)}`;
  const args = ["-na", "Ghostty", "--args", "-e", attachCmd];
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
