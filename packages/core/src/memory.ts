import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { weavePaths } from "./paths.ts";

// Memory is a folder of markdown files under ~/.weave/memory/, organized by
// category. The planner Claude reads + writes them via MCP tools. Design
// goals: human-readable, grep-able, version-controllable, no embeddings.
//
// File format: YAML frontmatter + markdown body.
//
//   ---
//   title: Plan-then-ticket before coding
//   category: pr-behavior
//   tags: [workflow, linear]
//   status: canonical
//   source: planner
//   updated: 2026-04-23T20:15:00.000Z
//   ---
//
//   <body>

export const CATEGORIES = [
  "architecture",   // ADRs, service boundaries, system shape
  "patterns",       // reusable coding/design patterns
  "testing",        // test conventions, e2e patterns, fixtures
  "pr-behavior",    // PR workflow, review style, merge rules
  "runbooks",       // debug playbooks, incident response
  "glossary",       // domain terms
  "sessions",       // drafts from auto-extract (promoted to canonical later)
] as const;

export type Category = (typeof CATEGORIES)[number];

export type MemoryFrontmatter = {
  title?: string;
  category?: string;
  tags?: string[];
  status?: "draft" | "canonical" | "deprecated";
  source?: string;
  updated?: string;
  [k: string]: unknown;
};

export type MemoryFile = {
  /** path relative to ~/.weave/memory/ */
  path: string;
  /** absolute path on disk */
  absPath: string;
  frontmatter: MemoryFrontmatter;
  body: string;
};

function memoryRoot(): string {
  return weavePaths().memoryDir;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "note";
}

function parseFrontmatter(raw: string): { frontmatter: MemoryFrontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const [, yaml, body] = match;
  const fm: MemoryFrontmatter = {};
  for (const line of yaml!.split("\n")) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    const val = rawVal!.trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      fm[key!] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      fm[key!] = val.replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter: fm, body: body ?? "" };
}

function formatFrontmatter(fm: MemoryFrontmatter): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => String(x)).join(", ")}]`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

export async function listMemories(opts: { category?: string; tag?: string } = {}): Promise<MemoryFile[]> {
  const root = memoryRoot();
  const glob = new Bun.Glob("**/*.md");
  const results: MemoryFile[] = [];
  for await (const relative of glob.scan({ cwd: root, absolute: false })) {
    if (relative === "INDEX.md") continue;
    const absPath = join(root, relative);
    const raw = await Bun.file(absPath).text();
    const { frontmatter, body } = parseFrontmatter(raw);
    if (opts.category && frontmatter.category !== opts.category && !relative.startsWith(`${opts.category}/`)) continue;
    if (opts.tag && !(Array.isArray(frontmatter.tags) && frontmatter.tags.includes(opts.tag))) continue;
    results.push({ path: relative, absPath, frontmatter, body });
  }
  results.sort((a, b) => (a.frontmatter.updated ?? "").localeCompare(b.frontmatter.updated ?? ""));
  return results;
}

export async function readMemory(relPath: string): Promise<MemoryFile | null> {
  const absPath = join(memoryRoot(), relPath);
  const file = Bun.file(absPath);
  if (!(await file.exists())) return null;
  const raw = await file.text();
  const { frontmatter, body } = parseFrontmatter(raw);
  return { path: relPath, absPath, frontmatter, body };
}

export type SearchHit = {
  path: string;
  line: number;
  snippet: string;
  title?: string;
};

export async function searchMemories(query: string, opts: { category?: string } = {}): Promise<SearchHit[]> {
  const root = memoryRoot();
  // Use plain Bun.Glob + string-includes for v1. Good enough for small memory
  // sets; we swap in ripgrep later if recall starts mattering.
  const glob = new Bun.Glob("**/*.md");
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  for await (const rel of glob.scan({ cwd: root, absolute: false })) {
    if (opts.category && !rel.startsWith(`${opts.category}/`)) continue;
    const raw = await Bun.file(join(root, rel)).text();
    const { frontmatter, body } = parseFrontmatter(raw);
    const lines = body.split("\n");
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(needle)) {
        hits.push({
          path: rel,
          line: i + 1,
          snippet: line.trim().slice(0, 200),
          title: typeof frontmatter.title === "string" ? frontmatter.title : undefined,
        });
      }
    });
  }
  return hits.slice(0, 50);
}

export async function recentMemories(opts: { limit?: number; category?: string } = {}): Promise<MemoryFile[]> {
  const all = await listMemories({ category: opts.category });
  // listMemories sorts ascending; we want descending
  all.sort((a, b) => (b.frontmatter.updated ?? "").localeCompare(a.frontmatter.updated ?? ""));
  return all.slice(0, opts.limit ?? 10);
}

export type RememberInput = {
  category: string;
  title: string;
  body: string;
  tags?: string[];
  status?: "draft" | "canonical" | "deprecated";
  source?: string;
};

export async function remember(input: RememberInput): Promise<MemoryFile> {
  if (!CATEGORIES.includes(input.category as Category)) {
    throw new Error(`unknown category: ${input.category}. valid: ${CATEGORIES.join(", ")}`);
  }
  const root = memoryRoot();
  const categoryDir = join(root, input.category);
  await mkdir(categoryDir, { recursive: true });

  const slug = slugify(input.title);
  const absPath = join(categoryDir, `${slug}.md`);
  const existing = await Bun.file(absPath).exists() ? await Bun.file(absPath).text() : null;

  // Merge: if file exists, preserve its frontmatter where applicable and
  // replace the body with the new body.
  let frontmatter: MemoryFrontmatter = {
    title: input.title,
    category: input.category,
    tags: input.tags ?? [],
    status: input.status ?? "canonical",
    source: input.source ?? "planner",
    updated: new Date().toISOString(),
  };
  if (existing) {
    const parsed = parseFrontmatter(existing);
    frontmatter = {
      ...parsed.frontmatter,
      ...frontmatter,
      tags: input.tags ?? parsed.frontmatter.tags ?? [],
    };
  }

  const content = `${formatFrontmatter(frontmatter)}\n\n${input.body.trim()}\n`;
  await Bun.write(absPath, content);

  return {
    path: relative(root, absPath),
    absPath,
    frontmatter,
    body: input.body,
  };
}

export async function forget(relPath: string): Promise<boolean> {
  const absPath = join(memoryRoot(), relPath);
  const file = Bun.file(absPath);
  if (!(await file.exists())) return false;
  await Bun.$`rm ${absPath}`.quiet();
  return true;
}
