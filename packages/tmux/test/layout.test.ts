import { describe, expect, test, afterEach } from "bun:test";
import {
  tmuxVersion,
  hasSession,
  newSession,
  killSession,
  listPanes,
  buildPlannerLayout,
} from "../src/index.ts";

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

describe.if(hasTmux)("buildPlannerLayout", () => {
  test("N=1: 1 planner + 1 worker = 2 panes total", async () => {
    const s = await fresh("weave-test-layout-1");
    const workers = await buildPlannerLayout(s, 1);
    expect(workers).toHaveLength(1);
    expect((await listPanes(s)).length).toBe(2);
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
