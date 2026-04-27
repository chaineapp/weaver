// Regression: `weave clean` must ONLY touch tmux sessions it can see via
// $TMUX_TMPDIR. When the test harness provides a sandboxed TMUX_TMPDIR,
// `weave clean` should see zero sessions and leave the real tmux server
// (where user's `weave-<project>` planners live) untouched.
//
// Prior bug: running this test suite killed the user's planner because the
// clean command enumerated /tmp/tmux-<uid>/default — the same socket the
// user was on — and killed every `weave-*` session found.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmuxTmpdir: string;
let userSessionName: string;
let userTmuxTmpdir: string;
let isolated = false;

// Guard: only run when TMUX_TMPDIR is explicitly an isolated sandbox dir
// (not the user's default `/tmp/tmux-$UID/...`). Without this, every
// default `bun test` killed the user's live planner session — that was
// THE BUG this test was meant to catch but instead kept causing.
//
// If isolation isn't set up, beforeAll silently returns and the test
// inside skips itself (test.skipIf below). To run for real:
//   WEAVER_RUN_CLEAN_ISOLATION=1 TMUX_TMPDIR=/tmp/weave-test-iso bun test packages/cli/test/clean-isolation.test.ts
function detectIsolation(): boolean {
  if (process.env.WEAVER_RUN_CLEAN_ISOLATION !== "1") return false;
  const t = process.env.TMUX_TMPDIR?.trim() ?? "";
  if (!t || t.startsWith("/tmp/tmux-")) return false;
  return t.includes("weave-test") || (t.startsWith(tmpdir()) && t !== tmpdir());
}

beforeAll(async () => {
  isolated = detectIsolation();
  if (!isolated) return;
  tmuxTmpdir = process.env.TMUX_TMPDIR!.trim();

  // "User" tmux server: mimics the real one. Never shares socket with sandbox.
  userTmuxTmpdir = await mkdtemp(join(tmpdir(), "weaver-user-tmux-"));
  userSessionName = `weave-user-session-${process.pid}`;
  // Spawn a session on the "user" server directly.
  await Bun.$`TMUX_TMPDIR=${userTmuxTmpdir} tmux new-session -d -s ${userSessionName} cat`.quiet();
});

afterAll(async () => {
  if (!isolated) return;
  // Tidy sandbox server first (while env is pointing at it).
  await Bun.$`tmux kill-server`.quiet().nothrow();

  // Tidy user server (independently of env) then its tmpdir.
  await Bun.$`TMUX_TMPDIR=${userTmuxTmpdir} tmux kill-server`.quiet().nothrow();
  await rm(userTmuxTmpdir, { recursive: true, force: true });
});

describe("isolation regression: `weave clean` cannot see the real user's tmux", () => {
  test.skipIf(!detectIsolation())("user's weave-* session survives even after cleanGlobal runs", async () => {
    // 1. User session exists on the user server.
    const userList = await Bun.$`TMUX_TMPDIR=${userTmuxTmpdir} tmux list-sessions -F '#{session_name}'`.text();
    expect(userList).toContain(userSessionName);

    // 2. Run cleanGlobal via the sandboxed env. Because TMUX_TMPDIR points at
    //    the empty sandbox, cleanGlobal() sees no sessions at all and kills
    //    none.
    const homeDir = await mkdtemp(join(tmpdir(), "weaver-clean-iso-home-"));
    process.env.HOME = homeDir;
    try {
      const { cleanGlobal } = await import("@weaver/core");
      const result = await cleanGlobal();
      expect(result.tmuxSessionsKilled).toBe(0);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }

    // 3. User session still alive.
    const stillThere = await Bun.$`TMUX_TMPDIR=${userTmuxTmpdir} tmux list-sessions -F '#{session_name}'`.text();
    expect(stillThere).toContain(userSessionName);
  });
});
