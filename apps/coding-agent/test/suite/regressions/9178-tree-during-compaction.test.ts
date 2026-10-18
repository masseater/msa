import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { assistantMsg, userMsg } from "../../utilities.ts";
import { createHarness, getMessageText, type Harness } from "../harness.ts";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

let harness!: Harness;

const rejectsNavigationBeforeTheActiveLeaf = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const compactionStarted = createDeferred();
  const compactionReleased = createDeferred();

  harness = yield* Effect.promise(() =>
    createHarness({
      settings: { compaction: { keepRecentTokens: 1 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            runPromise(
              Effect.gen(function* () {
                compactionStarted.resolve();
                yield* Effect.promise(() => compactionReleased.promise);
                return {
                  compaction: {
                    summary: "summary",
                    firstKeptEntryId: event.preparation.firstKeptEntryId,
                    tokensBefore: event.preparation.tokensBefore,
                    details: {},
                  },
                };
              }),
            ),
          );
        },
      ],
    }),
  );

  harness.sessionManager.appendMessage(userMsg("first user"));
  const navigationTargetId = harness.sessionManager.appendMessage(assistantMsg("first assistant"));
  harness.sessionManager.appendMessage(userMsg("second user"));
  const originalLeafId = harness.sessionManager.appendMessage(assistantMsg("second assistant"));
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

  const compactionPromise = harness.session.compact();
  yield* Effect.promise(() => compactionStarted.promise);

  expect(harness.session.isCompacting).toBe(true);
  try {
    yield* Effect.promise(() =>
      expect(
        harness.session.navigateTree(navigationTargetId, { summarize: false }),
      ).rejects.toThrow(
        "Wait for the current compaction or tree navigation to finish before navigating the session tree.",
      ),
    );
    expect(harness.sessionManager.getLeafId()).toBe(originalLeafId);
  } finally {
    compactionReleased.resolve();
  }
  yield* Effect.promise(() => compactionPromise);

  expect(harness.sessionManager.getEntries().at(-1)).toMatchObject({
    type: "compaction",
    parentId: originalLeafId,
  });
  expect(harness.session.messages.map(getMessageText)).toContain("second assistant");
});

const rejectsASecondNavigationWhileThe = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const navigationStarted = createDeferred();
  const navigationReleased = createDeferred();
  harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_tree", () =>
            runPromise(
              Effect.gen(function* () {
                navigationStarted.resolve();
                yield* Effect.promise(() => navigationReleased.promise);
              }),
            ),
          );
        },
      ],
    }),
  );

  const secondTargetId = harness.sessionManager.appendMessage(userMsg("first user"));
  const firstTargetId = harness.sessionManager.appendMessage(assistantMsg("first assistant"));
  harness.sessionManager.appendMessage(userMsg("second user"));
  const originalLeafId = harness.sessionManager.appendMessage(assistantMsg("second assistant"));
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

  const firstNavigation = harness.session.navigateTree(firstTargetId, { summarize: false });
  yield* Effect.promise(() => navigationStarted.promise);

  const secondNavigation = harness.session.navigateTree(secondTargetId, { summarize: false });
  expect(harness.sessionManager.getLeafId()).toBe(originalLeafId);
  navigationReleased.resolve();

  yield* Effect.promise(() =>
    expect(secondNavigation).rejects.toThrow(
      "Wait for the current compaction or tree navigation to finish before navigating the session tree.",
    ),
  );
  yield* Effect.promise(() => firstNavigation);
  expect(harness.sessionManager.getLeafId()).toBe(firstTargetId);
});

describe("issue #9178: tree navigation during manual compaction", () => {
  afterEach(() => harness?.cleanup());
  it("rejects navigation before the active leaf can change", () =>
    Effect.runPromise(rejectsNavigationBeforeTheActiveLeaf));
  it("rejects a second navigation while the first is waiting", () =>
    Effect.runPromise(rejectsASecondNavigationWhileThe));
});
