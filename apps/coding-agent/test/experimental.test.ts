import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";
import { withEnv } from "../src/core/process-env.ts";

const { runTest } = testing;

const expectEnabled = (value: string | undefined, expected: boolean) => () =>
  runTest(
    Effect.sync(() => expect(areExperimentalFeaturesEnabled()).toBe(expected)).pipe(
      withEnv({ MSA_EXPERIMENTAL: value }),
    ),
  );

describe("areExperimentalFeaturesEnabled", () => {
  it("returns false when MSA_EXPERIMENTAL is unset", expectEnabled(undefined, false));

  it("returns false when MSA_EXPERIMENTAL is empty", expectEnabled("", false));

  it("returns true when MSA_EXPERIMENTAL is set to 1", expectEnabled("1", true));

  it("returns false when MSA_EXPERIMENTAL is set to 0", expectEnabled("0", false));

  it("returns false when MSA_EXPERIMENTAL is set to a non-1 value", expectEnabled("true", false));
});
