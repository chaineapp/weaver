import { describe, expect, test } from "bun:test";
import { buildPlannerCommand } from "../src/commands/up.ts";

describe("buildPlannerCommand with custom binary", () => {
  test("default binary is claude", () => {
    expect(buildPlannerCommand()).toBe("claude");
  });

  test("bypass only applies to claude binary — not to gemini/custom", () => {
    expect(buildPlannerCommand({ binary: "gemini", bypass: true })).toBe("gemini");
    expect(buildPlannerCommand({ binary: "claude", bypass: true })).toBe(
      "claude --dangerously-skip-permissions",
    );
  });

  test("model flag still applied across binaries (passed through)", () => {
    expect(buildPlannerCommand({ binary: "gemini", model: "gemini-2.5-pro" })).toBe(
      "gemini --model gemini-2.5-pro",
    );
  });

  test("extraArgs lets custom binaries supply their own bypass", () => {
    expect(
      buildPlannerCommand({ binary: "gemini", bypass: true, extraArgs: "--yolo" }),
    ).toBe("gemini --yolo");
  });
});
