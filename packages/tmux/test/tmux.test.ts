import { describe, expect, test } from "bun:test";
import { tmuxVersion, hasSession, newSession, killSession, splitPane, sendKeys, listPanes, killPane } from "../src/tmux.ts";

const hasTmux = (await tmuxVersion()) !== null;
const sessionName = `weaver-test-${process.pid}`;

describe.if(hasTmux)("tmux integration", () => {
  test("newSession + hasSession + killSession lifecycle", async () => {
    expect(await hasSession(sessionName)).toBe(false);
    await newSession({ name: sessionName });
    expect(await hasSession(sessionName)).toBe(true);
    await killSession(sessionName);
    expect(await hasSession(sessionName)).toBe(false);
  });

  test("newSession enables mouse + focus-events by default", async () => {
    const session = `${sessionName}-opts`;
    try {
      await newSession({ name: session });
      const { getOption } = await import("../src/tmux.ts");
      expect(await getOption(session, "mouse")).toBe("on");
      expect(await getOption(session, "focus-events")).toBe("on");
    } finally {
      await killSession(session);
    }
  });

  test("selectPane makes a pane active", async () => {
    const session = `${sessionName}-active`;
    try {
      await newSession({ name: session });
      const newPaneId = await splitPane({ target: session, direction: "vertical" });
      // After split, the new pane is active. Re-select pane 0 and verify.
      const { selectPane } = await import("../src/tmux.ts");
      await selectPane(`${session}:0.0`);
      const panes = await listPanes(session);
      const active = panes.find((p) => p.active);
      expect(active).toBeDefined();
      expect(active!.paneId).not.toBe(newPaneId);
    } finally {
      await killSession(session);
    }
  });

  test("splitPane returns a pane id; listPanes sees it; killPane removes it", async () => {
    const session = `${sessionName}-split`;
    try {
      await newSession({ name: session });
      const newPane = await splitPane({ target: session, direction: "vertical" });
      expect(newPane).toMatch(/^%\d+$/);
      const panes = await listPanes(session);
      expect(panes.length).toBe(2);
      expect(panes.some((p) => p.paneId === newPane)).toBe(true);
      await killPane(newPane);
      const after = await listPanes(session);
      expect(after.length).toBe(1);
    } finally {
      await killSession(session);
    }
  });

  test("sendKeys injects text into a pane, capturable via pipe-pane", async () => {
    const session = `${sessionName}-sendkeys`;
    const outFile = `/tmp/weaver-sendkeys-${process.pid}.txt`;
    await Bun.write(outFile, "");
    try {
      // Start a session running /bin/sh. Pipe its output to outFile.
      await newSession({ name: session, command: "/bin/sh" });
      const panes = await listPanes(session);
      const pane = panes[0]!.paneId;
      const { pipePane } = await import("../src/tmux.ts");
      await pipePane(pane, outFile);
      // Inject a shell command that echoes a known string.
      await sendKeys(pane, "echo weaver-sentinel-42");
      // Wait for the shell to execute and pipe-pane to flush.
      await new Promise((r) => setTimeout(r, 400));
      const content = await Bun.file(outFile).text();
      expect(content).toContain("weaver-sentinel-42");
    } finally {
      await killSession(session);
      try {
        await Bun.$`rm -f ${outFile}`.quiet();
      } catch {
        /* ignore */
      }
    }
  });
});

describe.if(!hasTmux)("tmux not installed", () => {
  test("tmuxVersion returns null", async () => {
    expect(await tmuxVersion()).toBe(null);
  });
});
