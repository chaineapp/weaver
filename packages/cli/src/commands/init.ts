import { initProject, paths } from "@weaver/core";
import { writeSeedPlaybooks } from "./seed.ts";

export async function runInit(opts: { force?: boolean }): Promise<void> {
  const root = process.cwd();
  const config = await initProject(root, { force: opts.force });
  await writeSeedPlaybooks(paths(root).memoryDir);
  console.log(`✓ initialized Weaver project: ${config.projectName}`);
  console.log(`  tmux session: ${config.tmuxSession}`);
  console.log(`  config:       ${paths(root).config}`);
  console.log(`  mcp config:   ${paths(root).mcpJson}`);
  console.log(`  memory seed:  ${paths(root).memoryDir}`);
  console.log(`\nNext: run \`weave up --panes 3\` to open Ghostty and start working.`);
}
