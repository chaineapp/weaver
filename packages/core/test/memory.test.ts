import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "weaver-mem-"));
  process.env.HOME = home;
  await mkdir(join(home, ".weave", "memory"), { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("memory: remember + read round-trip", () => {
  test("creates a categorized markdown file with frontmatter", async () => {
    const { remember, readMemory } = await import("../src/index.ts");
    const saved = await remember({
      category: "pr-behavior",
      title: "Prefer small independent PRs",
      body: "Small PRs merge faster than stacked ones.\n\n**Why:** reviewer context is finite.\n",
      tags: ["workflow", "pr"],
    });
    expect(saved.path).toBe("pr-behavior/prefer-small-independent-prs.md");
    const got = await readMemory(saved.path);
    expect(got?.frontmatter.title).toBe("Prefer small independent PRs");
    expect(got?.frontmatter.category).toBe("pr-behavior");
    expect(got?.frontmatter.status).toBe("canonical");
    expect(got?.frontmatter.tags).toEqual(["workflow", "pr"]);
    expect(got?.body).toContain("Small PRs merge faster");
  });

  test("updating the same title updates the same file", async () => {
    const { remember, listMemories } = await import("../src/index.ts");
    await remember({ category: "patterns", title: "X", body: "v1" });
    await remember({ category: "patterns", title: "X", body: "v2" });
    const all = await listMemories({ category: "patterns" });
    expect(all).toHaveLength(1);
  });

  test("rejects unknown category", async () => {
    const { remember } = await import("../src/index.ts");
    await expect(
      remember({ category: "unknown-category", title: "X", body: "Y" }),
    ).rejects.toThrow();
  });
});

describe("memory: list + search + recent + forget", () => {
  test("lists, filters by category, and by tag", async () => {
    const { remember, listMemories } = await import("../src/index.ts");
    await remember({ category: "architecture", title: "A", body: "a", tags: ["core"] });
    await remember({ category: "architecture", title: "B", body: "b", tags: ["peripheral"] });
    await remember({ category: "testing", title: "C", body: "c", tags: ["core"] });

    expect((await listMemories()).length).toBe(3);
    expect((await listMemories({ category: "architecture" })).length).toBe(2);
    expect((await listMemories({ tag: "core" })).length).toBe(2);
    expect((await listMemories({ category: "architecture", tag: "core" })).length).toBe(1);
  });

  test("search finds content case-insensitively", async () => {
    const { remember, searchMemories } = await import("../src/index.ts");
    await remember({
      category: "runbooks",
      title: "Carrier tracking triage",
      body: "When a carrier goes silent, check the eventbridge DLQ first.",
    });
    const hits = await searchMemories("eventbridge");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.path).toContain("carrier-tracking-triage");
    expect(hits[0]!.snippet).toContain("eventbridge");
  });

  test("recent returns newest first", async () => {
    const { remember, recentMemories } = await import("../src/index.ts");
    await remember({ category: "patterns", title: "Older", body: "x" });
    await new Promise((r) => setTimeout(r, 20));
    await remember({ category: "patterns", title: "Newer", body: "y" });
    const r = await recentMemories({ limit: 2 });
    expect(r[0]!.frontmatter.title).toBe("Newer");
    expect(r[1]!.frontmatter.title).toBe("Older");
  });

  test("forget removes the file", async () => {
    const { remember, forget, listMemories } = await import("../src/index.ts");
    const saved = await remember({ category: "glossary", title: "CHA", body: "Chain identifier prefix" });
    expect((await listMemories()).length).toBe(1);
    expect(await forget(saved.path)).toBe(true);
    expect((await listMemories()).length).toBe(0);
    expect(await forget("does/not/exist.md")).toBe(false);
  });
});
