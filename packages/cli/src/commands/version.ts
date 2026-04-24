import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Show current version and optionally check the GitHub releases API for a newer
// one. Non-fatal: if the network call fails (offline, rate-limited, etc.) we
// just show the local version.

const RELEASE_API = "https://api.github.com/repos/chaineapp/weaver/releases/latest";

async function localVersion(): Promise<string> {
  const hereFile = fileURLToPath(import.meta.url);
  // Walk up from packages/cli/src/commands → repo root
  let dir = dirname(hereFile);
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "package.json");
    try {
      const raw = await readFile(candidate, "utf8");
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      if (pkg.name === "weaver") return pkg.version ?? "0.0.0";
    } catch {
      /* not here, keep walking */
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return "0.0.0";
}

async function latestVersion(): Promise<string | null> {
  try {
    const r = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "weaver-cli" },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const json = (await r.json()) as { tag_name?: string };
    if (!json.tag_name) return null;
    return json.tag_name.replace(/^v/, "");
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function runVersion(): Promise<void> {
  const current = await localVersion();
  const latest = await latestVersion();
  console.log(`weaver ${current}`);
  if (latest === null) {
    console.log(`  (couldn't reach GitHub to check for updates)`);
    return;
  }
  const cmp = compareVersions(latest, current);
  if (cmp > 0) {
    console.log(`  ↑ v${latest} is available — https://github.com/chaineapp/weaver/releases/tag/v${latest}`);
    console.log(`    cd ~/Code/weaver && git pull && bun install`);
  } else if (cmp === 0) {
    console.log(`  up to date`);
  } else {
    console.log(`  (ahead of latest release v${latest} — running unreleased main)`);
  }
}

// Cheap version check used at the top of other commands (weave up, etc.) to
// surface a one-line hint if a newer release is available. Caches to
// ~/.weave/.version-check so we only hit the API once per 24h.
export async function maybeNotifyUpdate(): Promise<void> {
  try {
    const { weavePaths } = await import("@weaver/core");
    const cachePath = join(weavePaths().weaveHome, ".version-check");
    const now = Date.now();
    const cache = Bun.file(cachePath);
    if (await cache.exists()) {
      const { checkedAt, latest } = (await cache.json()) as { checkedAt: number; latest: string };
      if (now - checkedAt < 24 * 60 * 60 * 1000) {
        const current = await localVersion();
        if (compareVersions(latest, current) > 0) {
          console.log(`(weaver v${latest} available — \`weave version\` for details)`);
        }
        return;
      }
    }
    const latest = await latestVersion();
    if (!latest) return;
    const current = await localVersion();
    await Bun.write(cachePath, JSON.stringify({ checkedAt: now, latest }));
    if (compareVersions(latest, current) > 0) {
      console.log(`(weaver v${latest} available — \`weave version\` for details)`);
    }
  } catch {
    /* never block the main command on a failed update check */
  }
}
