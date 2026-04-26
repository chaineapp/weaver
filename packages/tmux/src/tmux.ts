// Thin wrapper around the `tmux` CLI. Every function shells out via Bun.spawn.
// We use tmux as the programmable substrate under Ghostty because it gives us
// per-pane stdout capture (pipe-pane), deterministic send-keys, and survives
// terminal restarts.

export type SplitDirection = "horizontal" | "vertical";

export type PaneInfo = {
  paneId: string; // tmux pane id, e.g. "%5"
  paneIndex: number; // zero-based index within the window
  windowIndex: number;
  pid: number;
  active: boolean;
  title: string;
  // Foreground process command in the pane (the basename of argv[0] tmux sees,
  // e.g. "claude", "codex", "zsh"). Used by `weave up` to verify the planner
  // binary actually started — codex with a stale Node, claude with a missing
  // API key, etc. all exit silently and tmux closes the pane, leaving us with
  // a workers-only session that LOOKS healthy in the success log.
  currentCommand: string;
};

async function runTmux(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const proc = Bun.spawn(["tmux", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  } catch (err) {
    // tmux binary missing, non-executable, etc. Surface as non-zero exit.
    return { stdout: "", stderr: (err as Error).message, code: 127 };
  }
}

async function runOrThrow(args: string[]): Promise<string> {
  const { stdout, stderr, code } = await runTmux(args);
  if (code !== 0) {
    throw new Error(`tmux ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
  }
  return stdout;
}

export async function hasSession(name: string): Promise<boolean> {
  const { code } = await runTmux(["has-session", "-t", name]);
  return code === 0;
}

export async function newSession(opts: {
  name: string;
  cwd?: string;
  detached?: boolean;
  command?: string;
  env?: Record<string, string>;
  /** Default true: enable `mouse on` so click-to-focus works in Ghostty. */
  mouse?: boolean;
  /** Default true: enable `focus-events on` so Claude Code stops nagging. */
  focusEvents?: boolean;
}): Promise<void> {
  const args = ["new-session"];
  if (opts.detached !== false) args.push("-d");
  args.push("-s", opts.name);
  if (opts.cwd) args.push("-c", opts.cwd);
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      args.push("-e", `${k}=${v}`);
    }
  }
  if (opts.command) args.push(opts.command);
  await runOrThrow(args);

  // Apply per-session options after creation. `set-option -t <session> <opt>` is
  // session-scoped and doesn't bleed into the user's other tmux work.
  if (opts.mouse !== false) {
    await runOrThrow(["set-option", "-t", opts.name, "mouse", "on"]);
  }
  if (opts.focusEvents !== false) {
    await runOrThrow(["set-option", "-t", opts.name, "focus-events", "on"]);
  }
}

export async function selectPane(paneTarget: string): Promise<void> {
  await runOrThrow(["select-pane", "-t", paneTarget]);
}

export async function getOption(
  target: string,
  option: string,
): Promise<string | null> {
  const { stdout, code } = await runTmux(["show-options", "-t", target, option]);
  if (code !== 0) return null;
  // tmux prints e.g. `mouse on` — take the value after the first space.
  const line = stdout.trim();
  const idx = line.indexOf(" ");
  return idx < 0 ? null : line.slice(idx + 1);
}

// Customize the left side of the status bar for one session. Used by
// `weave up` to surface the project name without affecting other sessions.
// Styling: reverse-video block so it pops out of the status bar.
export async function setStatusLeft(session: string, text: string): Promise<void> {
  // #[reverse] turns on reverse-video; #[default] restores defaults. We wrap
  // the user-supplied text so colors are contained to this segment.
  const formatted = `#[reverse,bold]${text}#[default] `;
  await runOrThrow(["set-option", "-t", session, "status-left", formatted]);
  // Give it enough room — the default status-left-length is 10.
  const len = String(Math.max(40, text.length + 4));
  await runOrThrow(["set-option", "-t", session, "status-left-length", len]);
}

export async function killSession(name: string): Promise<void> {
  const { code, stderr } = await runTmux(["kill-session", "-t", name]);
  if (code !== 0 && !stderr.includes("can't find session") && !stderr.includes("no server running")) {
    throw new Error(`tmux kill-session ${name} failed: ${stderr.trim()}`);
  }
}

export async function splitPane(opts: {
  target: string; // session:window.pane
  direction: SplitDirection;
  cwd?: string;
  command?: string;
  percent?: number; // size percentage
}): Promise<string> {
  const args = ["split-window", "-t", opts.target, "-P", "-F", "#{pane_id}"];
  args.push(opts.direction === "horizontal" ? "-h" : "-v");
  if (opts.cwd) args.push("-c", opts.cwd);
  if (typeof opts.percent === "number") args.push("-p", String(opts.percent));
  if (opts.command) args.push(opts.command);
  const stdout = await runOrThrow(args);
  return stdout.trim(); // the new pane id
}

export async function sendKeys(paneId: string, text: string, submit = true): Promise<void> {
  await runOrThrow(["send-keys", "-t", paneId, text]);
  if (submit) await runOrThrow(["send-keys", "-t", paneId, "Enter"]);
}

export async function pipePane(paneId: string, outputPath: string): Promise<void> {
  // `tmux pipe-pane -o` toggles piping; we unconditionally establish a new pipe.
  // The `-I -O` flags capture both stdin and stdout; here we only need stdout.
  await runOrThrow(["pipe-pane", "-t", paneId, "-o", `cat >> ${shellQuote(outputPath)}`]);
}

export async function killPane(paneId: string): Promise<void> {
  const { code, stderr } = await runTmux(["kill-pane", "-t", paneId]);
  if (code !== 0 && !stderr.includes("can't find pane")) {
    throw new Error(`tmux kill-pane ${paneId} failed: ${stderr.trim()}`);
  }
}

export async function listPanes(session: string): Promise<PaneInfo[]> {
  const format = "#{pane_id}|#{pane_index}|#{window_index}|#{pane_pid}|#{pane_active}|#{pane_current_command}|#{pane_title}";
  const stdout = await runOrThrow(["list-panes", "-s", "-t", session, "-F", format]);
  const panes: PaneInfo[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < 7) continue;
    panes.push({
      paneId: parts[0]!,
      paneIndex: Number(parts[1]),
      windowIndex: Number(parts[2]),
      pid: Number(parts[3]),
      active: parts[4] === "1",
      currentCommand: parts[5]!,
      title: parts.slice(6).join("|"),
    });
  }
  return panes;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export async function tmuxVersion(): Promise<string | null> {
  const { stdout, code } = await runTmux(["-V"]);
  if (code !== 0) return null;
  return stdout.trim();
}
