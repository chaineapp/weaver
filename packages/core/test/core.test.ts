import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect HOME so weavePaths() uses an isolated directory for each test.
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "weaver-home-"));
  process.env.HOME = home;
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("initWeave", () => {
  test("creates ~/.weave/ on first run, no-op on subsequent", async () => {
    const { initWeave, readConfig } = await import("../src/index.ts");
    const first = await initWeave();
    expect(first.firstRun).toBe(true);
    expect(first.weaveHome).toBe(join(home, ".weave"));
    const cfg = await readConfig();
    expect(cfg?.version).toBe(1);

    const second = await initWeave();
    expect(second.firstRun).toBe(false);
  });
});

describe("projects registry", () => {
  test("registers new project on first resolveOrRegister", async () => {
    const { initWeave, resolveOrRegister } = await import("../src/index.ts");
    await initWeave();
    const repo = await mkdtemp(join(tmpdir(), "weaver-fake-repo-"));
    const result = await resolveOrRegister(repo);
    expect(result.created).toBe(true);
    expect(result.worktree.id).toBe("main");
    expect(result.worktree.path).toBe(repo);
    expect(result.project.rootPath).toBe(repo);
    await rm(repo, { recursive: true });
  });

  test("registers a worktree under an existing project when path is inside it", async () => {
    const { initWeave, resolveOrRegister } = await import("../src/index.ts");
    await initWeave();
    const repo = await mkdtemp(join(tmpdir(), "weaver-fake-repo-"));
    const worktree = join(repo, ".claude", "worktrees", "feature-x");
    await mkdir(worktree, { recursive: true });

    const main = await resolveOrRegister(repo);
    const wt = await resolveOrRegister(worktree);
    expect(wt.created).toBe(true);
    expect(wt.project.id).toBe(main.project.id);
    expect(wt.worktree.id).toBe("feature-x");
    expect(Object.keys(wt.project.worktrees).sort()).toEqual(["feature-x", "main"]);
    await rm(repo, { recursive: true });
  });

  test("idempotent resolution", async () => {
    const { initWeave, resolveOrRegister } = await import("../src/index.ts");
    await initWeave();
    const repo = await mkdtemp(join(tmpdir(), "weaver-fake-repo-"));
    const a = await resolveOrRegister(repo);
    const b = await resolveOrRegister(repo);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.project.id).toBe(a.project.id);
    await rm(repo, { recursive: true });
  });
});

describe("pane registry", () => {
  test("lastReviewedByte round-trip", async () => {
    const { initWeave, upsertPaneRecord, getPaneRecord, setLastReviewedByte } = await import("../src/index.ts");
    await initWeave();
    await upsertPaneRecord({
      id: "%7",
      projectId: "chain5",
      worktreeId: "main",
      task: "test",
      status: "running",
      tmuxSession: "weave-chain5",
      runFile: "/tmp/doesnt-matter",
      lastReviewedByte: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await setLastReviewedByte("%7", 1024);
    const r = await getPaneRecord("%7");
    expect(r?.lastReviewedByte).toBe(1024);
  });
});

describe("waitForUpdates", () => {
  test("returns empty after timeout when nothing changes", async () => {
    const { initWeave, waitForUpdates } = await import("../src/index.ts");
    await initWeave();
    const start = Date.now();
    const r = await waitForUpdates({ timeoutSeconds: 0 /* will still run one poll */, pollMs: 50 });
    expect(r).toEqual([]);
    expect(Date.now() - start).toBeLessThan(300);
  });

  test("detects pane growth within timeout", async () => {
    const { initWeave, waitForUpdates, upsertPaneRecord, weavePaths } = await import("../src/index.ts");
    await initWeave();
    const runFile = weavePaths().runFile("%9");
    await Bun.write(runFile, '{"type":"thread.started","thread_id":"t1"}\n');
    await upsertPaneRecord({
      id: "%9",
      projectId: "p",
      worktreeId: "main",
      task: "t",
      status: "running",
      tmuxSession: "weave-p",
      runFile,
      lastReviewedByte: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // mark as fully reviewed, then grow after a delay
    const { setLastReviewedByte } = await import("../src/index.ts");
    const size = (await Bun.file(runFile).size);
    await setLastReviewedByte("%9", size);

    setTimeout(async () => {
      const text = await Bun.file(runFile).text();
      await Bun.write(runFile, text + '{"type":"turn.started","turn_id":"u1"}\n');
    }, 150);

    const r = await waitForUpdates({ timeoutSeconds: 2, pollMs: 100 });
    expect(r.length).toBe(1);
    expect(r[0]!.pane_id).toBe("%9");
    expect(r[0]!.new_bytes).toBeGreaterThan(0);
  });
});
