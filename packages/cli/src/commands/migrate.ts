import { rm } from "node:fs/promises";
import { join } from "node:path";

// `weave migrate <path>` — clean up legacy per-project .weave/ and .mcp.json
// left over from v0.1's project-scoped design. Safe to re-run.

export async function runMigrate(opts: { path: string }): Promise<void> {
  const root = opts.path;
  const weaveDir = join(root, ".weave");
  const mcpJson = join(root, ".mcp.json");

  let cleaned = 0;
  try {
    await rm(weaveDir, { recursive: true, force: true });
    cleaned++;
  } catch {
    /* ignore */
  }
  // Only remove .mcp.json if it was Weaver's minimal single-server config.
  // If the user has other servers in there, we leave it alone.
  try {
    const file = Bun.file(mcpJson);
    if (await file.exists()) {
      const data = (await file.json()) as { mcpServers?: Record<string, unknown> };
      const servers = Object.keys(data.mcpServers ?? {});
      if (servers.length === 1 && servers[0] === "weaver") {
        await rm(mcpJson, { force: true });
        cleaned++;
      } else if ("weaver" in (data.mcpServers ?? {})) {
        const rest = { ...(data.mcpServers as Record<string, unknown>) };
        delete rest.weaver;
        const next = { ...data, mcpServers: rest };
        await Bun.write(mcpJson, JSON.stringify(next, null, 2) + "\n");
        console.log(`  stripped weaver entry from ${mcpJson} (kept other servers)`);
        cleaned++;
      }
    }
  } catch {
    /* ignore */
  }

  console.log(`✓ migrate ${root}: ${cleaned} legacy file(s) cleaned`);
}
