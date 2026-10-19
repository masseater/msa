import { fauxAssistantMessage } from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { ExtensionFactory } from "../../../src/index.ts";
import { createHarness, type Harness } from "../harness.ts";

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
          recorded.push({ type: event.type, reason: event.reason, willRetry: event.willRetry });
          return {
            compaction: {
              summary: "summary from extension",
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
              details: {},
            },
          };
        }),
      ),
    );
    msa.on("session_compact", (event) =>
      Effect.runPromise(
        Effect.sync(() => {
          recorded.push({ type: event.type, reason: event.reason, willRetry: event.willRetry });
        }),
      ),
    );
  };
}

function createCompactionHarness(recorded: RecordedCompactionEvent[]): Promise<Harness> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() =>
        createHarness({
          settings: { compaction: { keepRecentTokens: 1 } },
          extensionFactories: [recordingExtension(recorded)],
        }),
      );
      harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
      yield* Effect.promise(() => harness.session.prompt("first"));
      yield* Effect.promise(() => harness.session.prompt("second"));
      return harness;
    }),
  );
}

const harnesses: Harness[] = [];

const reportsManualReasonForCompact = Effect.gen(function* () {
  const recorded: RecordedCompactionEvent[] = [];
  const harness = yield* Effect.promise(() => createCompactionHarness(recorded));
  harnesses.push(harness);

  yield* Effect.promise(() => harness.session.compact());

  expect(recorded).toEqual([
    { type: "session_before_compact", reason: "manual", willRetry: false },
    { type: "session_compact", reason: "manual", willRetry: false },
  ]);
});

const reportsThresholdReasonForAutoCompaction = Effect.gen(function* () {
  const recorded: RecordedCompactionEvent[] = [];
  const harness = yield* Effect.promise(() => createCompactionHarness(recorded));
  harnesses.push(harness);
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

  yield* Effect.promise(() => sessionInternals["runAutoCompaction"]("threshold", false));

  expect(recorded).toEqual([
    { type: "session_before_compact", reason: "threshold", willRetry: false },
    { type: "session_compact", reason: "threshold", willRetry: false },
  ]);
});

const reportsOverflowReasonAndWillretryFor = Effect.gen(function* () {
  const recorded: RecordedCompactionEvent[] = [];
  const harness = yield* Effect.promise(() => createCompactionHarness(recorded));
  harnesses.push(harness);
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

  yield* Effect.promise(() => sessionInternals["runAutoCompaction"]("overflow", true));

  expect(recorded).toEqual([
    { type: "session_before_compact", reason: "overflow", willRetry: true },
    { type: "session_compact", reason: "overflow", willRetry: true },
  ]);
});

describe("issue #5217 compaction reason on extension events", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("reports manual reason for compact()", () => Effect.runPromise(reportsManualReasonForCompact));
  it("reports threshold reason for auto-compaction", () =>
    Effect.runPromise(reportsThresholdReasonForAutoCompaction));
  it("reports overflow reason and willRetry for overflow recovery", () =>
    Effect.runPromise(reportsOverflowReasonAndWillretryFor));
});
