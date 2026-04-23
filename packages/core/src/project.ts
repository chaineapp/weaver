import { basename } from "node:path";
import { mkdir } from "node:fs/promises";
import { paths } from "./paths.ts";
import { writeConfig, type ProjectConfig } from "./config.ts";

// `weave init` — scaffold .weave/ and .mcp.json in a project root.

const MCP_CONFIG = {
  mcpServers: {
    weaver: {
      type: "stdio",
      command: "weave",
      args: ["mcp"],
    },
  },
};

export async function initProject(projectRoot: string, opts: { force?: boolean } = {}): Promise<ProjectConfig> {
  const p = paths(projectRoot);

  // Create .weave/ directory tree
  await mkdir(p.weaveDir, { recursive: true });
  await mkdir(p.runsDir, { recursive: true });
  await mkdir(p.memoryDir, { recursive: true });

  // Write .mcp.json (project-scoped MCP config). Do not overwrite existing config
  // without --force because the user may have other servers configured.
  const mcpFile = Bun.file(p.mcpJson);
  if (await mcpFile.exists()) {
    const existing = (await mcpFile.json()) as { mcpServers?: Record<string, unknown> };
    const merged = {
      ...existing,
      mcpServers: {
        ...(existing.mcpServers ?? {}),
        weaver: MCP_CONFIG.mcpServers.weaver,
      },
    };
    await Bun.write(p.mcpJson, JSON.stringify(merged, null, 2) + "\n");
  } else {
    await Bun.write(p.mcpJson, JSON.stringify(MCP_CONFIG, null, 2) + "\n");
  }

  // Write .weave/config.json
  const projectName = basename(projectRoot);
  const tmuxSession = `weave-${projectName}`;
  const config: ProjectConfig = {
    projectName,
    tmuxSession,
    createdAt: new Date().toISOString(),
  };

  const configFile = Bun.file(p.config);
  if ((await configFile.exists()) && !opts.force) {
    // Keep the existing config; return it.
    return (await configFile.json()) as ProjectConfig;
  }
  await writeConfig(projectRoot, config);
  return config;
}
