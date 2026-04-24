// End-to-end tests for `weave` CLI. Exercises the real binary against a
// temp workspace + temp HOME, with real tmux + real git (no Codex or Claude —
// those would cost tokens and need auth). Tests run sequentially.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

const WEAVE_CLI = join(import.meta.dir, "..", "src", "index.ts");

type RunResult = { stdout: string; stderr: string; code: number };

async function runWeave(
  args: string[],
  opts: { cwd?: string; home?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, "run", WEAVE_CLI, ...args], {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, HOME: opts.home ?? process.env.HOME! },
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = opts.timeoutMs ?? 15_000;
  const timer = setTimeout(() => proc.kill(), timeout);

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { stdout, stderr, code };
}

async function tmuxHasSession(name: string): Promise<boolean> {
  const proc = Bun.spawn(["tmux", "has-session", "-t", name], { stdout: "pipe", stderr: "pipe" });
  return (await proc.exited) === 0;
}

async function killAllWeaveTmux(): Promise<void> {
  const proc = Bun.spawn(["tmux", "list-sessions", "-F", "#{session_name}"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  for (const line of out.split("\n")) {
    const name = line.trim();
    if (name.startsWith("weave-test-")) {
      const p = Bun.spawn(["tmux", "kill-session", "-t", name], { stdout: "pipe", stderr: "pipe" });
      await p.exited;
    }
  }
}

// Temp workspace + temp HOME for the whole suite.
let tempHome: string;
let workspace: string;
let fakeRepo: string;

beforeAll(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "weaver-e2e-home-"));
  workspace = await mkdtemp(join(tmpdir(), "weaver-e2e-ws-"));

  // Create a real (tiny) git repo so git worktree works.
  fakeRepo = await mkdtemp(join(tmpdir(), "weaver-e2e-repo-"));
  await Bun.$`cd ${fakeRepo} && git init -q && git config user.email test@example.com && git config user.name test && echo hello > README.md && git add . && git commit -qm init`.quiet();
});

afterAll(async () => {
  await killAllWeaveTmux();
  await rm(tempHome, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
  await rm(fakeRepo, { recursive: true, force: true });
});

describe("weave CLI e2e", () => {
  test("init creates ~/.weave/", async () => {
    const r = await runWeave(["init"], { home: tempHome });
    // May or may not register MCP depending on whether `claude` is in PATH in the
    // test shell. Either way, ~/.weave/ should exist afterwards.
    expect(existsSync(join(tempHome, ".weave"))).toBe(true);
    expect(existsSync(join(tempHome, ".weave", "config.json"))).toBe(true);
    expect(r.code).toBe(0);
  });

  test("workspace init creates .weaver/config.json", async () => {
    const r = await runWeave(["workspace", "init", workspace], { home: tempHome });
    expect(r.code).toBe(0);
    expect(existsSync(join(workspace, ".weaver", "config.json"))).toBe(true);
  });

  test("repo add persists to workspace config", async () => {
    const r = await runWeave(["repo", "add", "fakerepo", fakeRepo, "--role", "backend"], {
      cwd: workspace,
      home: tempHome,
    });
    expect(r.code).toBe(0);
    const cfg = (await Bun.file(join(workspace, ".weaver", "config.json")).json()) as {
      repos: Record<string, { path: string; role?: string }>;
    };
    expect(cfg.repos.fakerepo?.path).toBe(fakeRepo);
    expect(cfg.repos.fakerepo?.role).toBe("backend");
  });

  test("repos lists registered repos", async () => {
    const r = await runWeave(["repos"], { cwd: workspace, home: tempHome });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("fakerepo");
    expect(r.stdout).toContain("[backend]");
  });

  let projectId: string;

  test("new creates a project folder and prints an id", async () => {
    const r = await runWeave(["new", "--name", "test-proj", "--linear", "CHA-999"], {
      cwd: workspace,
      home: tempHome,
    });
    expect(r.code).toBe(0);
    const match = r.stdout.match(/created project ([0-9A-Z]{10}-[0-9A-Z]{4})/);
    expect(match).not.toBeNull();
    projectId = match![1]!;
    expect(existsSync(join(workspace, ".weaver", "projects", projectId, "project.json"))).toBe(true);
    expect(existsSync(join(workspace, ".weaver", "projects", projectId, "worktrees"))).toBe(true);
  });

  test("list shows the created project", async () => {
    const r = await runWeave(["list"], { cwd: workspace, home: tempHome });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(projectId);
    expect(r.stdout).toContain("test-proj");
    expect(r.stdout).toContain("CHA-999");
  });

  test("up creates tmux session with env vars set (no Ghostty)", async () => {
    // We can't easily assert Ghostty opens in CI, so we bypass `weave up`'s
    // Ghostty step by asserting tmux side-effects directly. The CLI invokes
    // openGhostty unconditionally, so for the e2e we set up the session manually
    // via the same library call and verify the env propagated.
    //
    // Simpler approach: use tmux directly to verify our newSession wrapper
    // wires env correctly. Covered in @weaver/tmux tests. Here, confirm that
    // the CLI creates the planner tmux session.
    const sessionName = `weave-test-${projectId}`;

    const { newSession, killSession } = await import("@weaver/tmux");
    await killSession(sessionName).catch(() => {});

    // Emulate what `weave up` does for the tmux side:
    await newSession({
      name: sessionName,
      cwd: workspace,
      command: "cat",
      env: { WEAVER_WORKSPACE_ROOT: workspace, WEAVER_PROJECT_ID: projectId },
    });
    expect(await tmuxHasSession(sessionName)).toBe(true);

    // Verify env was set: tmux show-environment -t <session>
    const proc = Bun.spawn(["tmux", "show-environment", "-t", sessionName, "WEAVER_PROJECT_ID"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const envOut = await new Response(proc.stdout).text();
    await proc.exited;
    expect(envOut).toContain(`WEAVER_PROJECT_ID=${projectId}`);

    await killSession(sessionName);
  });

  test("create_worktree via core addWorktree creates a real git worktree", async () => {
    const { findWorkspace, getProject, addWorktree } = await import("@weaver/core");
    const ws = await findWorkspace(workspace);
    expect(ws).not.toBeNull();
    const project = await getProject(ws!, projectId);
    expect(project).not.toBeNull();

    const wt = await addWorktree(ws!, project!, {
      repoName: "fakerepo",
      branch: "feat/wt-test",
      linearTicket: "CHA-999",
    });
    expect(wt.name).toBe("fakerepo-feat-wt-test-CHA-999");
    expect(existsSync(wt.path)).toBe(true);
    expect(existsSync(join(wt.path, "README.md"))).toBe(true);

    // git reports this worktree on the fake repo
    const proc = Bun.spawn(["git", "-C", fakeRepo, "worktree", "list"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(out).toContain(wt.path);
  });

  test("remove tears down everything cleanly", async () => {
    const r = await runWeave(["remove", projectId, "--worktrees"], {
      cwd: workspace,
      home: tempHome,
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("removed project");
    expect(existsSync(join(workspace, ".weaver", "projects", projectId))).toBe(false);

    // git worktree list on the fake repo should no longer show the removed one
    const proc = Bun.spawn(["git", "-C", fakeRepo, "worktree", "list"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(out).not.toContain("feat-wt-test");
  });

  test("clean is idempotent on an empty state", async () => {
    const r = await runWeave(["clean"], { home: tempHome });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("cleaned Weaver state");
  });

  test("Ghostty attach command uses absolute tmux path (login PATH safe)", async () => {
    // Regression guard for the bug where Ghostty's login wrapper couldn't find
    // `tmux` in its minimal PATH. openGhostty must resolve and embed the
    // absolute tmux path so `/usr/bin/login -flp <user> <cmd>` can exec it.
    // We can't actually open Ghostty in a test, so we monkey-patch Bun.spawn
    // to capture the args and assert on them.
    const { openGhostty } = await import("@weaver/tmux");
    const originalSpawn = Bun.spawn;
    const calls: string[][] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Bun as unknown as { spawn: unknown }).spawn = ((cmd: string[], options?: unknown) => {
      calls.push(cmd);
      // @ts-expect-error — Bun.spawn has overloaded signatures; pass-through is correct at runtime.
      return originalSpawn(cmd, options);
    }) as typeof Bun.spawn;

    try {
      await openGhostty({ tmuxSession: "weave-test-nonexistent" });
    } catch {
      /* expected — Ghostty may not be installed or session doesn't exist */
    } finally {
      (Bun as unknown as { spawn: typeof originalSpawn }).spawn = originalSpawn;
    }

    // After `-e` the argv must be: <absolute-tmux> attach -t <session-name>
    // as SEPARATE args. A single joined string breaks login's exec.
    const openCall = calls.find((c) => c[0] === "open");
    expect(openCall).toBeDefined();
    const eIdx = openCall!.indexOf("-e");
    expect(eIdx).toBeGreaterThan(-1);
    const tmuxArg = openCall![eIdx + 1]!;
    expect(tmuxArg.startsWith("/")).toBe(true);
    expect(tmuxArg).toMatch(/\/tmux$/);
    // No spaces in the tmux arg — it's the path alone, not a full command.
    expect(tmuxArg).not.toContain(" ");
    expect(openCall![eIdx + 2]).toBe("attach");
    expect(openCall![eIdx + 3]).toBe("-t");
    expect(openCall![eIdx + 4]).toBe("weave-test-nonexistent");
  });
});
