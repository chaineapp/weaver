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
}): Promise<void> {
  const args = ["new-session"];
  if (opts.detached !== false) args.push("-d");
  args.push("-s", opts.name);
  if (opts.cwd) args.push("-c", opts.cwd);
  if (opts.command) args.push(opts.command);
  await runOrThrow(args);
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
  const format = "#{pane_id}|#{pane_index}|#{window_index}|#{pane_pid}|#{pane_active}|#{pane_title}";
  const stdout = await runOrThrow(["list-panes", "-s", "-t", session, "-F", format]);
  const panes: PaneInfo[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < 6) continue;
    panes.push({
      paneId: parts[0]!,
      paneIndex: Number(parts[1]),
      windowIndex: Number(parts[2]),
      pid: Number(parts[3]),
      active: parts[4] === "1",
      title: parts.slice(5).join("|"),
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
