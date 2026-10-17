import { afterEach, describe, expect, it } from "vite-plus/test";

import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
  const originalMsaExperimental = process.env["MSA_EXPERIMENTAL"];

  afterEach(() => {
    if (originalMsaExperimental === undefined) {
      delete process.env["MSA_EXPERIMENTAL"];
    } else {
      process.env["MSA_EXPERIMENTAL"] = originalMsaExperimental;
    }
  });

  it("returns false when MSA_EXPERIMENTAL is unset", () => {
    delete process.env["MSA_EXPERIMENTAL"];

    expect(areExperimentalFeaturesEnabled()).toBe(false);
  });

  it("returns false when MSA_EXPERIMENTAL is empty", () => {
    process.env["MSA_EXPERIMENTAL"] = "";

    expect(areExperimentalFeaturesEnabled()).toBe(false);
  });

  it("returns true when MSA_EXPERIMENTAL is set to 1", () => {
    process.env["MSA_EXPERIMENTAL"] = "1";

    expect(areExperimentalFeaturesEnabled()).toBe(true);
  });

  it("returns false when MSA_EXPERIMENTAL is set to 0", () => {
    process.env["MSA_EXPERIMENTAL"] = "0";

    expect(areExperimentalFeaturesEnabled()).toBe(false);
  });

  it("returns false when MSA_EXPERIMENTAL is set to a non-1 value", () => {
    process.env["MSA_EXPERIMENTAL"] = "true";

    expect(areExperimentalFeaturesEnabled()).toBe(false);
  });
});
