import { join } from "node:path";

// File-system layout of a Weaver-initialized project:
//
//   <projectRoot>/
//     .mcp.json                 (written by `weave init`, points at `weave mcp`)
//     .weave/
//       config.json             project-level config
//       panes.json               pane registry (v1 — simple JSON, not SQLite)
//       runs/<pane_id>.jsonl     per-pane JSONL transcripts (tee'd via tmux pipe-pane)
//       memory/                  seed playbooks + (later) auto-extract output

export type WeavePaths = {
  root: string;
  mcpJson: string;
  weaveDir: string;
  config: string;
  panes: string;
  runsDir: string;
  runFile: (paneId: string) => string;
  memoryDir: string;
};

export function paths(projectRoot: string): WeavePaths {
  const weaveDir = join(projectRoot, ".weave");
  const runsDir = join(weaveDir, "runs");
  return {
    root: projectRoot,
    mcpJson: join(projectRoot, ".mcp.json"),
    weaveDir,
    config: join(weaveDir, "config.json"),
    panes: join(weaveDir, "panes.json"),
    runsDir,
    runFile: (paneId: string) => join(runsDir, `${sanitizePaneId(paneId)}.jsonl`),
    memoryDir: join(weaveDir, "memory"),
  };
}

// tmux pane ids start with `%` which is a safe filename char, but keep this
// tight in case we expand pane identification later.
function sanitizePaneId(paneId: string): string {
  return paneId.replace(/[^A-Za-z0-9_%-]/g, "_");
}
