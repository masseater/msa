import { Effect } from "effect";
import { expect } from "vite-plus/test";
import { describeEval } from "vitest-evals";

import { createMsaCodingAgentHarness } from "../src/harness.ts";
import { readEnv } from "../src/platform.ts";

const harness = createMsaCodingAgentHarness({ noTools: "all" });

describeEval("Answer a basic prompt", { harness }, (it) => {
  it("returns the expected answer", ({ run }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          run("What's the capital of France? Respond with only the city name."),
        );
        expect(result.output.trim()).toBe("Paris");
        expect(result.errors).toEqual([]);
        expect(result.usage).toMatchObject({
          provider: readEnv("MSA_PROVIDER"),
          model: readEnv("MSA_MODEL"),
        });
        expect(result.usage.totalTokens).toBeGreaterThan(0);
      }),
    ));
});
