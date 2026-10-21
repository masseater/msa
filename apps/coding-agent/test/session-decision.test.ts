import localModule from "@msa/ai/providers/local";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import localModelEvents from "../src/core/decision/local-model-events.ts";
import harnessModule from "./suite/harness.ts";

const { awaited, runTest } = testing;
const { LIQUID_D1 } = localModule;
const { emitLocalModelEvent } = localModelEvents;
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
        harness.cleanup();
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
        const decision = yield* harness.session.integrations.decision.decideInternal.decide({
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
        });

        const reason = 'decision.model "local/none" is not an available classifier';
        expect(decision).toEqual({ reason, status: "undecided" });
        expect(customEntries(harness.sessionManager.getEntries(), "decision")).toEqual([
          { name: "triage", reason, status: "undecided" },
        ]);
      } finally {
        harness.cleanup();
      }
    }),
  );

const recordsTheDownloadInTenths = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* awaited(createHarness());
      try {
        const uri = LIQUID_D1.baseUrl;
        const progress = (downloadedBytes: number) => ({
          downloadedBytes,
          totalBytes: 1000,
          type: "download-progress" as const,
          uri,
        });
        emitLocalModelEvent({ type: "download-started", uri });
        for (const bytes of [0, 50, 100, 150, 990, 1000]) emitLocalModelEvent(progress(bytes));
        emitLocalModelEvent({ path: "/models/d1.gguf", type: "ready", uri });
        harness.cleanup();
        emitLocalModelEvent({ message: "after close", type: "failed", uri });

        expect(customEntries(harness.sessionManager.getEntries(), "decision_model")).toEqual([
          { type: "download-started", uri },
          progress(0),
          progress(100),
          progress(990),
          progress(1000),
          { path: "/models/d1.gguf", type: "ready", uri },
        ]);
      } finally {
        harness.cleanup();
      }
    }),
  );

describe("session decision", () => {
  it("offers Liquid D1 as a classifier of the local provider", offersLiquidD1);

  it(
    "records an undecided decision in the session when decision.model is not a classifier",
    recordsAnUndecidedDecision,
  );

  it(
    "records the download of the local decision model in tenths and its outcome",
    recordsTheDownloadInTenths,
  );
});
