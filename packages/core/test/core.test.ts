import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "weaver-home-"));
  process.env.HOME = home;
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("initWeave", () => {
  test("creates ~/.weave/ and writes config", async () => {
    const { initWeave, readConfig } = await import("../src/index.ts");
    const r = await initWeave();
    expect(r.firstRun).toBe(true);
    expect(r.weaveHome).toBe(join(home, ".weave"));
    expect((await readConfig())?.version).toBe(1);
  });
});

describe("workspace", () => {
  test("initWorkspace + findWorkspace walks up from a subdir", async () => {
    const { initWorkspace, findWorkspace } = await import("../src/index.ts");
    const wsRoot = await mkdtemp(join(tmpdir(), "weaver-ws-"));
    await initWorkspace(wsRoot, [{ name: "chain5", path: "/tmp/chain5", role: "backend" }]);
    const deep = join(wsRoot, "a", "b", "c");
    await mkdir(deep, { recursive: true });
    const found = await findWorkspace(deep);
    expect(found?.root).toBe(wsRoot);
    expect(found?.config.repos.chain5?.role).toBe("backend");
    await rm(wsRoot, { recursive: true });
  });

  test("findWorkspace returns null when none exists above", async () => {
    const { findWorkspace } = await import("../src/index.ts");
    const bare = await mkdtemp(join(tmpdir(), "weaver-bare-"));
    expect(await findWorkspace(bare)).toBe(null);
    await rm(bare, { recursive: true });
  });
});

describe("projects", () => {
  test("id is derived from slugified name; duplicates get -2, -3 suffixes", async () => {
    const { initWorkspace, createProject } = await import("../src/index.ts");
    const wsRoot = await mkdtemp(join(tmpdir(), "weaver-ws-"));
    const ws = await initWorkspace(wsRoot);

    const a = await createProject(ws, { name: "Tracking Fraud Notifications" });
    expect(a.id).toBe("tracking-fraud-notifications");

    const b = await createProject(ws, { name: "Tracking Fraud Notifications" });
    expect(b.id).toBe("tracking-fraud-notifications-2");

    const c = await createProject(ws, { name: "Tracking Fraud Notifications" });
    expect(c.id).toBe("tracking-fraud-notifications-3");

    // Names with special chars slugify sensibly
    const d = await createProject(ws, { name: "feat/auth — token refresh (v2)" });
    expect(d.id).toBe("feat-auth-token-refresh-v2");

    await rm(wsRoot, { recursive: true });
  });

  test("name is required", async () => {
    const { initWorkspace, createProject } = await import("../src/index.ts");
    const wsRoot = await mkdtemp(join(tmpdir(), "weaver-ws-"));
    const ws = await initWorkspace(wsRoot);
    await expect(createProject(ws, { name: "" })).rejects.toThrow();
    await rm(wsRoot, { recursive: true });
  });

  test("createProject + listProjects + getProject", async () => {
    const { initWorkspace, createProject, listProjects, getProject } = await import("../src/index.ts");
    const wsRoot = await mkdtemp(join(tmpdir(), "weaver-ws-"));
    const ws = await initWorkspace(wsRoot);
    const p = await createProject(ws, { name: "shipment-v2", linearTicket: "CHA-950" });
    expect(p.id).toBe("shipment-v2");
    expect(p.name).toBe("shipment-v2");
    expect(p.linearTicket).toBe("CHA-950");

    const list = await listProjects(ws);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(p.id);

    const again = await getProject(ws, p.id);
    expect(again?.name).toBe("shipment-v2");
    await rm(wsRoot, { recursive: true });
  });

  test("createProject writes CLAUDE.md AND AGENTS.md priming the planner to dispatch", async () => {
    const { initWorkspace, createProject } = await import("../src/index.ts");
    const wsRoot = await mkdtemp(join(tmpdir(), "weaver-ws-"));
    const ws = await initWorkspace(wsRoot, [
      { name: "chain5", path: "/tmp/chain5", role: "backend" },
    ]);
    const p = await createProject(ws, { name: "task-a", linearTicket: "CHA-100" });
    const claudeMd = await Bun.file(
      join(wsRoot, ".weaver", "projects", p.id, "CLAUDE.md"),
    ).text();
    // The brief teaches the planner to dispatch via Bash (CHA-1012 — MCP
    // tools don't reach the model in Claude Code 2.1.119, so we route worker
    // control through `weave dispatch` / `weave tail` shell commands).
    expect(claudeMd).toContain("weave dispatch");
    expect(claudeMd).toContain("weave tail");
    expect(claudeMd).toContain("worker-N");
    expect(claudeMd).toContain("main planner");
    expect(claudeMd).toContain("task-a");
    expect(claudeMd).toContain("CHA-100");
    expect(claudeMd).toContain("chain5");
    // Codex doesn't read CLAUDE.md, so the same brief is written to AGENTS.md
    // alongside it. Both files must exist with identical content.
    const agentsMd = await Bun.file(
      join(wsRoot, ".weaver", "projects", p.id, "AGENTS.md"),
    ).text();
    expect(agentsMd).toBe(claudeMd);
    await rm(wsRoot, { recursive: true });
  });

  test("createProject persists per-project plannerBinary override", async () => {
    const { initWorkspace, createProject } = await import("../src/index.ts");
    const wsRoot = await mkdtemp(join(tmpdir(), "weaver-ws-"));
    const ws = await initWorkspace(wsRoot, []);
    const p = await createProject(ws, { name: "codex-led", plannerBinary: "codex" });
    expect(p.plannerBinary).toBe("codex");
    // Re-read from disk to confirm it round-trips (project.json field).
    const meta = JSON.parse(
      await Bun.file(join(wsRoot, ".weaver", "projects", p.id, "project.json")).text(),
    );
    expect(meta.plannerBinary).toBe("codex");
    await rm(wsRoot, { recursive: true });
  });
});

describe("worktreeName derivation", () => {
  test("<repo>-<branch>-<linear>", async () => {
    const { worktreeName } = await import("../src/index.ts");
    expect(worktreeName("chain5", "feat/foo-bar", "CHA-950")).toBe("chain5-feat-foo-bar-CHA-950");
    expect(worktreeName("chain-zen", "main", null)).toBe("chain-zen-main");
  });
});

describe("pane registry", () => {
  test("lastReviewedByte round-trip with new shape", async () => {
    const { initWeave, upsertPaneRecord, getPaneRecord, setLastReviewedByte } = await import("../src/index.ts");
    await initWeave();
    await upsertPaneRecord({
      id: "%7",
      workspaceRoot: "/tmp/ws",
      projectId: "P123",
      worktreeName: "chain5-feat-foo",
      task: "test",
      status: "running",
      tmuxSession: "weave-P123-chain5-feat-foo",
      runFile: "/tmp/doesnt-matter",
      lastReviewedByte: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await setLastReviewedByte("%7", 1024);
    expect((await getPaneRecord("%7"))?.lastReviewedByte).toBe(1024);
  });
});

describe("waitForUpdates", () => {
  test("empty when nothing to report", async () => {
    const { initWeave, waitForUpdates } = await import("../src/index.ts");
    await initWeave();
    const r = await waitForUpdates({ timeoutSeconds: 0, pollMs: 50 });
    expect(r).toEqual([]);
  });

  test("detects growth", async () => {
    const { initWeave, upsertPaneRecord, setLastReviewedByte, waitForUpdates, weavePaths } = await import(
      "../src/index.ts"
    );
    await initWeave();
    const runFile = weavePaths().runFile("%9");
    await Bun.write(runFile, "a\n");
    await upsertPaneRecord({
      id: "%9",
      workspaceRoot: "/tmp/ws",
      projectId: "P123",
      worktreeName: "chain5-main",
      task: "t",
      status: "running",
      tmuxSession: "weave-P",
      runFile,
      lastReviewedByte: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await setLastReviewedByte("%9", Bun.file(runFile).size);
    setTimeout(async () => {
      const t = await Bun.file(runFile).text();
      await Bun.write(runFile, t + "b\n");
    }, 120);
    const r = await waitForUpdates({ timeoutSeconds: 2, pollMs: 80 });
    expect(r.length).toBe(1);
    expect(r[0]!.pane_id).toBe("%9");
  });
});
