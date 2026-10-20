import { fauxAssistantMessage } from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { ExtensionFactory } from "../../../src/index.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;

type SessionWithCompactionInternals = {
  runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
};

interface RecordedCompactionEvent {
  type: "session_before_compact" | "session_compact";
  reason: "manual" | "threshold" | "overflow";
  willRetry: boolean;
}

function recordingExtension(recorded: RecordedCompactionEvent[]): ExtensionFactory {
  return (msa) => {
    msa.on("session_before_compact", (event) =>
      Effect.runPromise(
        Effect.sync(() => {
          recorded.push({ reason: event.reason, type: event.type, willRetry: event.willRetry });
          return {
            compaction: {
              details: {},
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              summary: "summary from extension",
              tokensBefore: event.preparation.tokensBefore,
            },
          };
        }),
      ),
    );
    msa.on("session_compact", (event) =>
      Effect.runPromise(
        Effect.sync(() => {
          recorded.push({ reason: event.reason, type: event.type, willRetry: event.willRetry });
        }),
      ),
    );
  };
}

function createCompactionHarness(
  recorded: RecordedCompactionEvent[],
): Promise<harnessTypes.Harness> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() =>
        createHarness({
          extensionFactories: [recordingExtension(recorded)],
          settings: { compaction: { keepRecentTokens: 1 } },
        }),
      );
      harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
      yield* Effect.promise(() => harness.session.prompt("first"));
      yield* Effect.promise(() => harness.session.prompt("second"));
      return harness;
    }),
  );
}

const harnesses: harnessTypes.Harness[] = [];

const reportsManualReasonForCompact = Effect.gen(function* () {
  const recorded: RecordedCompactionEvent[] = [];
  const harness = yield* Effect.promise(() => createCompactionHarness(recorded));
  harnesses.push(harness);

  yield* Effect.promise(() => harness.session.compact());

  expect(recorded).toEqual([
    { reason: "manual", type: "session_before_compact", willRetry: false },
    { reason: "manual", type: "session_compact", willRetry: false },
  ]);
});

const reportsThresholdReasonForAutoCompaction = Effect.gen(function* () {
  const recorded: RecordedCompactionEvent[] = [];
  const harness = yield* Effect.promise(() => createCompactionHarness(recorded));
  harnesses.push(harness);
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

  yield* Effect.promise(() => sessionInternals["runAutoCompaction"]("threshold", false));

  expect(recorded).toEqual([
    { reason: "threshold", type: "session_before_compact", willRetry: false },
    { reason: "threshold", type: "session_compact", willRetry: false },
  ]);
});

const reportsOverflowReasonAndWillretryFor = Effect.gen(function* () {
  const recorded: RecordedCompactionEvent[] = [];
  const harness = yield* Effect.promise(() => createCompactionHarness(recorded));
  harnesses.push(harness);
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

  yield* Effect.promise(() => sessionInternals["runAutoCompaction"]("overflow", true));

  expect(recorded).toEqual([
    { reason: "overflow", type: "session_before_compact", willRetry: true },
    { reason: "overflow", type: "session_compact", willRetry: true },
  ]);
});

const reportsManualReasonForCompact2 = () => Effect.runPromise(reportsManualReasonForCompact);

const reportsThresholdReasonForAutoCompaction2 = () =>
  Effect.runPromise(reportsThresholdReasonForAutoCompaction);

const reportsOverflowReasonAndWillretryForOverflow = () =>
  Effect.runPromise(reportsOverflowReasonAndWillretryFor);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("issue #5217 compaction reason on extension events", () => {
  afterEach(afterEachHook);
  it("reports manual reason for compact()", reportsManualReasonForCompact2);
  it("reports threshold reason for auto-compaction", reportsThresholdReasonForAutoCompaction2);
  it(
    "reports overflow reason and willRetry for overflow recovery",
    reportsOverflowReasonAndWillretryForOverflow,
  );
});
