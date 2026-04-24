import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  tmuxVersion,
  hasSession,
  newSession,
  killSession,
  listPanes,
  buildPlannerLayout,
} from "../src/index.ts";

// Isolate from user's tmux server — see e2e.test.ts for the full rationale.
let tmuxTmpdir: string;
let originalTmuxTmpdir: string | undefined;

beforeAll(async () => {
  tmuxTmpdir = await mkdtemp(join(tmpdir(), "weaver-layout-test-"));
  originalTmuxTmpdir = process.env.TMUX_TMPDIR;
  process.env.TMUX_TMPDIR = tmuxTmpdir;
});

afterAll(async () => {
  const p = Bun.spawn(["tmux", "kill-server"], { stdout: "pipe", stderr: "pipe" });
  await p.exited;
  if (originalTmuxTmpdir === undefined) delete process.env.TMUX_TMPDIR;
  else process.env.TMUX_TMPDIR = originalTmuxTmpdir;
  await rm(tmuxTmpdir, { recursive: true, force: true });
});

const hasTmux = (await tmuxVersion()) !== null;
const createdSessions: string[] = [];

afterEach(async () => {
  while (createdSessions.length > 0) {
    const name = createdSessions.pop()!;
    try {
      await killSession(name);
    } catch {
      /* ignore */
    }
  }
});

async function fresh(name: string): Promise<string> {
  if (await hasSession(name)) await killSession(name);
  await newSession({ name, command: "cat" });
  createdSessions.push(name);
  return name;
}

async function paneGeom(session: string): Promise<{ id: string; left: number; top: number; w: number; h: number }[]> {
  const proc = Bun.spawn(
    ["tmux", "list-panes", "-t", session, "-F", "#{pane_id}|#{pane_left}|#{pane_top}|#{pane_width}|#{pane_height}"],
    { stdout: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out
    .trim()
    .split("\n")
    .map((line) => {
      const [id, left, top, w, h] = line.split("|");
      return { id: id!, left: +left!, top: +top!, w: +w!, h: +h! };
    });
}

describe.if(hasTmux)("buildPlannerLayout", () => {
  test("N=1: 1 planner + 1 worker = 2 panes total", async () => {
    const s = await fresh("weave-test-layout-1");
    const workers = await buildPlannerLayout(s, 1);
    expect(workers).toHaveLength(1);
    expect((await listPanes(s)).length).toBe(2);
  });

  test("planner (pane 0) takes full left half height for every N", async () => {
    // Guard against regressing to a layout that shrinks the planner vertically.
    for (const n of [2, 3, 4, 5, 6] as const) {
      const s = await fresh(`weave-test-layout-fullheight-${n}`);
      await buildPlannerLayout(s, n);
      const geom = await paneGeom(s);
      const maxBottom = Math.max(...geom.map((g) => g.top + g.h));
      // Pane 0 is the one at left=0,top=0.
      const planner = geom.find((g) => g.left === 0 && g.top === 0);
      expect(planner).toBeDefined();
      // Planner height should span from top (0) to the bottom of the window.
      expect(planner!.h).toBe(maxBottom);
    }
  });

  test("N=2: 1 planner + 2 workers = 3 panes total", async () => {
    const s = await fresh("weave-test-layout-2");
    const workers = await buildPlannerLayout(s, 2);
    expect(workers).toHaveLength(2);
    expect((await listPanes(s)).length).toBe(3);
  });

  test("N=3: 1 planner + 3 workers = 4 panes total", async () => {
    const s = await fresh("weave-test-layout-3");
    const workers = await buildPlannerLayout(s, 3);
    expect(workers).toHaveLength(3);
    expect((await listPanes(s)).length).toBe(4);
  });

  test("N=4: 2x2 grid on right = 5 panes total", async () => {
    const s = await fresh("weave-test-layout-4");
    const workers = await buildPlannerLayout(s, 4);
    expect(workers).toHaveLength(4);
    expect((await listPanes(s)).length).toBe(5);
  });

  test("N=5: 3 rows with 2+2+1 cols = 6 panes total", async () => {
    const s = await fresh("weave-test-layout-5");
    const workers = await buildPlannerLayout(s, 5);
    expect(workers).toHaveLength(5);
    expect((await listPanes(s)).length).toBe(6);
  });

  test("N=6: 2x3 grid on right = 7 panes total", async () => {
    const s = await fresh("weave-test-layout-6");
    const workers = await buildPlannerLayout(s, 6);
    expect(workers).toHaveLength(6);
    expect((await listPanes(s)).length).toBe(7);
  });

  test("N=0 and N=7 throw", async () => {
    const s = await fresh("weave-test-layout-invalid");
    await expect(buildPlannerLayout(s, 0)).rejects.toThrow();
    await expect(buildPlannerLayout(s, 7)).rejects.toThrow();
  });
});
