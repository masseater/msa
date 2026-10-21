import { describe, expect, it } from "vite-plus/test";

import getEffortThinkingLevelMap from "../scripts/models-dev-reasoning-options.ts";

describe("getEffortThinkingLevelMap", () => {
  it("exposes only verified effort values and none", () => {
    expect(
      getEffortThinkingLevelMap([
        { type: "toggle" },
        { type: "effort", values: ["none", "low", "high", "max"] },
      ]),
    ).toEqual({
      high: "high",
      low: "low",
      max: "max",
      medium: null,
      minimal: null,
      off: "none",
      xhigh: null,
    });
  });

  it("does not infer thinking-off from an effort list", () => {
    expect(getEffortThinkingLevelMap([{ type: "effort", values: ["low", "high", "max"] }])).toEqual(
      {
        high: "high",
        low: "low",
        max: "max",
        medium: null,
        minimal: null,
        off: null,
        xhigh: null,
      },
    );
  });

  it("leaves toggle and budget controls for their adapter-specific implementations", () => {
    expect(getEffortThinkingLevelMap([{ type: "toggle" }])).toBeUndefined();
    expect(
      getEffortThinkingLevelMap([{ max: 32000, min: 1024, type: "budget_tokens" }]),
    ).toBeUndefined();
    expect(
      getEffortThinkingLevelMap([{ type: "effort", values: [null, "default"] }]),
    ).toBeUndefined();
  });
});
