import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage } = ai;

const { harnesses, seedCompactableSession, useSummaryStreamFn } = agentSessionCompactionSupport;

const { createHarness } = harnessModule;

const autoCompactsWithACustomStreamfn = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);
  seedCompactableSession(harness);
  const getStreamCallCount = useSummaryStreamFn(harness, "auto summary from custom stream");
  const sessionInternals = harness.session.compaction.auto;

  yield* Effect.promise(() => sessionInternals["runAutoCompaction"]("threshold", false));

  const compactionEntries = harness.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "compaction");
  const compactionEnd = harness.eventsOfType("compaction_end").at(-1);
  expect(compactionEntries).toHaveLength(1);
  expect(compactionEnd?.result?.estimatedTokensAfter).toBeGreaterThan(0);
  expect(getStreamCallCount()).toBe(1);
});

const notifiesExtensionsWhenAutoCompactionFailsSetup = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const failedEvents: Array<{
      reason: "manual" | "threshold" | "overflow";
      errorMessage?: string | undefined;
      aborted: boolean;
      willRetry: boolean;
      fromExtension: boolean;
    }> = [];
    return { failedEvents, runPromise };
  });

const notifiesExtensionsWhenAutoCompactionFails = Effect.gen(function* () {
  const { failedEvents, runPromise } = yield* notifiesExtensionsWhenAutoCompactionFailsSetup();
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_compact_failed", (event) =>
            runPromise(
              Effect.sync(() => {
                failedEvents.push(event);
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  seedCompactableSession(harness);
  harness.session.agent.streamFunction = () => {
    throw new Error("summary generator blew up");
  };
  const sessionInternals = harness.session.compaction.auto;

  yield* Effect.promise(() =>
    expect(sessionInternals["runAutoCompaction"]("threshold", false)).resolves.toBe(false),
  );

  expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
    aborted: false,
    errorMessage: "Auto-compaction failed: summary generator blew up",
    reason: "threshold",
    willRetry: false,
  });
  expect(failedEvents).toEqual([
    expect.objectContaining({
      aborted: false,
      errorMessage: "Auto-compaction failed: summary generator blew up",
      fromExtension: false,
      reason: "threshold",
      type: "session_compact_failed",
      willRetry: false,
    }),
  ]);
});

const compactsAndResumesAfterALength = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                details: {},
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                summary: "overflow compacted",
                tokensBefore: event.preparation.tokensBefore,
              },
            }),
          );
        },
      ],
      models: [{ contextWindow: 1000, id: "faux-1", maxTokens: 100 }],
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("partial response", { stopReason: "length" }),
    fauxAssistantMessage("completed response"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("x".repeat(5000)));

  expect(harness.faux.state.callCount).toBe(2);
  expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
    aborted: false,
    reason: "overflow",
    willRetry: true,
  });
  expect(harness.session.context.transcript.getLastAssistantText()).toBe("completed response");
});

const autoCompactsWithACustomStreamfnWhen = () =>
  Effect.runPromise(autoCompactsWithACustomStreamfn);

const notifiesExtensionsWhenAutoCompactionFails2 = () =>
  Effect.runPromise(notifiesExtensionsWhenAutoCompactionFails);

const compactsAndResumesAfterALengthStop = () => Effect.runPromise(compactsAndResumesAfterALength);

const afterEachHook2 = () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("AgentSession compaction characterization", () => {
  afterEach(afterEachHook2);

  it(
    "auto-compacts with a custom streamFn when registry auth is absent",
    autoCompactsWithACustomStreamfnWhen,
  );

  it("notifies extensions when auto-compaction fails", notifiesExtensionsWhenAutoCompactionFails2);

  it(
    "compacts and resumes after a length stop below the desired output limit",
    compactsAndResumesAfterALengthStop,
  );
});
