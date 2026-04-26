import { join } from "node:path";
import { homedir } from "node:os";

function resolveHome(): string {
  // process.env.HOME honors test isolation; homedir() is the fallback when HOME is unset.
  return process.env.HOME ?? homedir();
}

// Weaver state is global: ~/.weave/ holds the projects registry, pane registry,
// all run-file transcripts, and seed memory. Repos and worktrees never have
// Weaver files inside them — you can run `weave up --path <any-dir>` and it
// auto-registers.

export type WeavePaths = {
  weaveHome: string;                 // ~/.weave
  config: string;                    // ~/.weave/config.json
  projects: string;                  // ~/.weave/projects.json
  panes: string;                     // ~/.weave/panes.json
  runsDir: string;                   // ~/.weave/runs/
  runFile: (paneId: string) => string;
  memoryDir: string;                 // ~/.weave/memory/
  // User-level voice / standing prefs / philosophy. Auto-injected into every
  // planner session via --append-system-prompt. Inspired by openclaw's SOUL.md.
  // Edit by hand; survives `weave clean`.
  userMd: string;                    // ~/.weave/USER.md
};

export function weavePaths(): WeavePaths {
  const weaveHome = join(resolveHome(), ".weave");
  const runsDir = join(weaveHome, "runs");
  return {
    weaveHome,
    config: join(weaveHome, "config.json"),
    projects: join(weaveHome, "projects.json"),
    panes: join(weaveHome, "panes.json"),
    runsDir,
    runFile: (paneId: string) => join(runsDir, `${sanitizePaneId(paneId)}.jsonl`),
    memoryDir: join(weaveHome, "memory"),
    userMd: join(weaveHome, "USER.md"),
  };
}

// Read ~/.weave/USER.md if present. Returns trimmed content, or null if the
// file doesn't exist or is empty after trim.
export async function readUserMd(): Promise<string | null> {
  const file = Bun.file(weavePaths().userMd);
  if (!(await file.exists())) return null;
  const text = (await file.text()).trim();
  return text.length > 0 ? text : null;
}

function sanitizePaneId(paneId: string): string {
  // Strip `%` — tmux's pipe-pane command runs through strftime, which would
  // mangle `%1` as a (nonexistent) format specifier and eat the character.
  // The remaining numeric id is unique enough within ~/.weave/runs/.
  return paneId.replace(/%/g, "").replace(/[^A-Za-z0-9_-]/g, "_");
}
