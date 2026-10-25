import localModule from "@msa/ai/providers/local";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import decideModule from "../src/core/decision/decide.ts";
import harnessModule from "./suite/harness.ts";

const { awaited, runTest } = testing;
const { LIQUID_D1 } = localModule;
const { decide } = decideModule;
const { createHarness } = harnessModule;

const customEntries = (
  entries: ReadonlyArray<{ type: string; customType?: string; data?: unknown }>,
  customType: string,
) =>
  entries
    .filter((entry) => entry.type === "custom" && entry.customType === customType)
    .map((entry) => entry.data);

const offersLiquidD1 = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* awaited(createHarness());
      try {
        const model = harness.session.models.selection.modelRuntimeInternal.getModelOfType(
          "classifier",
          LIQUID_D1.provider,
          LIQUID_D1.id,
        );

        expect(model?.api).toBe("node-llama-cpp-classify");
        expect(model?.baseUrl).toBe(LIQUID_D1.baseUrl);
      } finally {
        yield* awaited(harness.cleanup());
      }
    }),
  );

const recordsAnUndecidedDecision = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* awaited(
        createHarness({ settings: { decision: { model: "local/none" } } }),
      );
      try {
        const decision = yield* decide({
          name: "triage",
          questions: {
            urgent: {
              criteria: { false: "can wait", true: "needs action now" },
              instructions: "Is it urgent?",
              threshold: 0.5,
              type: "bool",
            },
          },
          state: { ticket: "The build fails." },
        }).pipe((effect) => harness.session.integrations.decision.provide(effect));

        const reason = 'decision.model "local/none" is not an available classifier';
        expect(decision).toEqual({ reason, status: "undecided" });
        expect(customEntries(harness.sessionManager.getEntries(), "decision")).toEqual([
          { name: "triage", reason, status: "undecided" },
        ]);
      } finally {
        yield* awaited(harness.cleanup());
      }
    }),
  );

describe("session decision", () => {
  it("offers Liquid D1 as a classifier of the local provider", offersLiquidD1);

  it(
    "records an undecided decision in the session when decision.model is not a classifier",
    recordsAnUndecidedDecision,
  );
});
