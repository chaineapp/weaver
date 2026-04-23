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
  };
}

function sanitizePaneId(paneId: string): string {
  return paneId.replace(/[^A-Za-z0-9_%-]/g, "_");
}
