import { mkdir } from "node:fs/promises";
import { weavePaths } from "./paths.ts";
import { readConfig, writeConfig, defaultConfig } from "./config.ts";

// `weave init` — global, runs once. Creates ~/.weave/, writes default config.
// MCP server registration happens in the CLI layer (it shells out to `claude mcp add`).

export async function initWeave(): Promise<{ firstRun: boolean; weaveHome: string }> {
  const p = weavePaths();
  await mkdir(p.weaveHome, { recursive: true });
  await mkdir(p.runsDir, { recursive: true });
  await mkdir(p.memoryDir, { recursive: true });

  const existing = await readConfig();
  if (existing) return { firstRun: false, weaveHome: p.weaveHome };

  await writeConfig(defaultConfig());
  return { firstRun: true, weaveHome: p.weaveHome };
}
