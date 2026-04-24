import { describe, expect, test } from "bun:test";
import { buildPlannerCommand } from "../src/commands/up.ts";

describe("buildPlannerCommand", () => {
  test("default — plain `claude`", () => {
    expect(buildPlannerCommand()).toBe("claude");
    expect(buildPlannerCommand({})).toBe("claude");
    expect(buildPlannerCommand({ bypass: false })).toBe("claude");
  });

  test("--bypass — claude --dangerously-skip-permissions", () => {
    expect(buildPlannerCommand({ bypass: true })).toBe(
      "claude --dangerously-skip-permissions",
    );
  });
});
