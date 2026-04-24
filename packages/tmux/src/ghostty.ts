// Ghostty integration. Keep this minimal: Weaver's programmable surface is
// tmux, not Ghostty.

// True if the current process is running inside a Ghostty terminal — in which
// case `weave up` should open the new session as a *tab* of the current
// window, not a brand new window. Detected by env vars Ghostty sets:
//   - TERM_PROGRAM=ghostty (always)
//   - GHOSTTY_RESOURCES_DIR=... (set when running inside the bundle)
export function isInsideGhostty(): boolean {
  return (
    process.env.TERM_PROGRAM === "ghostty" || !!process.env.GHOSTTY_RESOURCES_DIR
  );
}

// Open `tmuxSession` as a new tab in the *current* Ghostty window using
// AppleScript. Returns true on success, false if AppleScript can't drive
// Ghostty (missing Accessibility permissions, app not frontmost, etc.) — the
// caller should then fall back to openGhostty (new window).
//
// macOS-only. The tab title is set via tmux's `set-titles` + `set -g
// allow-rename on` already configured in newSession; the inner `tmux attach`
// will surface the project name.
export async function openGhosttyTab(opts: {
  tmuxSession: string;
  title?: string;
}): Promise<boolean> {
  const tmux = await resolveTmuxPath();
  // Compose the command we want the new tab to run. Single-quoted for AppleScript;
  // tmux + session name are filesystem-safe so simple quoting is fine.
  const cmd = `${tmux} attach -t ${opts.tmuxSession}`;
  // Send Cmd+T to the frontmost Ghostty window, then type the command.
  // delay 0.25 lets the tab render before keystrokes land.
  const script = [
    'tell application "Ghostty" to activate',
    "delay 0.15",
    'tell application "System Events" to keystroke "t" using command down',
    "delay 0.25",
    `tell application "System Events" to keystroke "${cmd}"`,
    "tell application \"System Events\" to key code 36",
  ].join("\n");
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return code === 0;
}

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
