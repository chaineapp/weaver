// In-Ghostty Weaver control surface. Installs an F12 display-menu with common
// config toggles and a custom `weave>` prompt — the "little command line for
// the Weaver layer" the user asked for.
//
// Key bindings in tmux are server-wide (root key-table has no per-session
// scope), so we set these on the current tmux server. F12 is rarely bound
// by anything else; collision risk is low.

async function runTmux(args: string[]): Promise<void> {
  const proc = Bun.spawn(["tmux", ...args], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`tmux ${args.join(" ")} failed: ${stderr.trim()}`);
  }
}

// Each menu entry is [label, hotkey, command]. `command` is a tmux command
// string. `run-shell` runs a background shell (so the menu closes);
// `display-popup -E` opens a popup that waits for exit.
const MENU_ITEMS: Array<[string, string, string]> = [
  ["planner bypass ON", "b", "run-shell 'weave config set planner.bypass on'"],
  ["planner bypass OFF", "B", "run-shell 'weave config set planner.bypass off'"],
  ["worker bypass ON", "w", "run-shell 'weave config set worker.bypass on'"],
  ["worker bypass OFF", "W", "run-shell 'weave config set worker.bypass off'"],
  ["restart planner WITH bypass", "r", "run-shell 'weave restart-planner --bypass'"],
  ["restart planner WITHOUT bypass", "R", "run-shell 'weave restart-planner --no-bypass'"],
  [
    "version",
    "v",
    "display-popup -E -w 70% -h 30% \"weave version; echo; read -n 1 -s -p 'press any key to close'\"",
  ],
  [
    "config list",
    "l",
    "display-popup -E -w 70% -h 50% \"weave config list; echo; read -n 1 -s -p 'press any key to close'\"",
  ],
  [
    "custom weave command...",
    "c",
    "command-prompt -p 'weave>' 'run-shell \"weave %1\"'",
  ],
];

export async function installWeaverMenu(): Promise<void> {
  const args: string[] = [
    "bind-key",
    "-n",
    "F12",
    "display-menu",
    "-T",
    "#[align=centre]weaver",
    "-x",
    "S",
    "-y",
    "S",
  ];
  for (const [label, key, cmd] of MENU_ITEMS) {
    args.push(label, key, cmd);
  }
  await runTmux(args);
}

// For tests — verifies the F12 binding is present.
export async function isWeaverMenuInstalled(): Promise<boolean> {
  const proc = Bun.spawn(["tmux", "list-keys", "-T", "root"], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.split("\n").some((line) => /\bF12\b/.test(line) && line.includes("display-menu"));
}
