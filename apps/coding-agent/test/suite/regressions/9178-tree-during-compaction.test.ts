import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import utilities from "../../utilities.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness, getMessageText } = harnessModule;
const { assistantMsg, userMsg } = utilities;

const { gate } = testing;

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  const promise = gate();
  return { promise, resolve: () => promise.release() };
}

let harness!: harnessTypes.Harness;

const rejectsNavigationBeforeTheActiveLeafPart1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const compactionStarted = createDeferred();
    const compactionReleased = createDeferred();

    harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("session_before_compact", (event) =>
              runPromise(
                Effect.gen(function* () {
                  compactionStarted.resolve();
                  yield* Effect.promise(() => compactionReleased.promise);
                  return {
                    compaction: {
                      details: {},
                      firstKeptEntryId: event.preparation.firstKeptEntryId,
                      summary: "summary",
                      tokensBefore: event.preparation.tokensBefore,
                    },
                  };
                }),
              ),
            );
          },
        ],
        settings: { compaction: { keepRecentTokens: 1 } },
      }),
    );
    return { compactionReleased, compactionStarted };
  });

const rejectsNavigationBeforeTheActiveLeaf = Effect.gen(function* () {
  const { compactionReleased, compactionStarted } =
    yield* rejectsNavigationBeforeTheActiveLeafPart1();

  harness.sessionManager.appendMessage(userMsg("first user"));
  const navigationTargetId = harness.sessionManager.appendMessage(assistantMsg("first assistant"));
  harness.sessionManager.appendMessage(userMsg("second user"));
  const originalLeafId = harness.sessionManager.appendMessage(assistantMsg("second assistant"));
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

  const compactionPromise = harness.session.compaction.manual.compact();
  yield* Effect.promise(() => compactionStarted.promise);

  expect(harness.session.compaction.manual.isCompacting).toBe(true);
  try {
    yield* Effect.promise(() =>
      expect(
        harness.session.context.tree.navigateTree(navigationTargetId, { summarize: false }),
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
    parentId: originalLeafId,
    type: "compaction",
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

  const firstNavigation = harness.session.context.tree.navigateTree(firstTargetId, {
    summarize: false,
  });
  yield* Effect.promise(() => navigationStarted.promise);

  const secondNavigation = harness.session.context.tree.navigateTree(secondTargetId, {
    summarize: false,
  });
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

const rejectsNavigationBeforeTheActiveLeafCan = () =>
  Effect.runPromise(rejectsNavigationBeforeTheActiveLeaf);

const rejectsASecondNavigationWhileTheFirst = () =>
  Effect.runPromise(rejectsASecondNavigationWhileThe);

describe("issue #9178: tree navigation during manual compaction", () => {
  afterEach(() => harness?.cleanup());
  it(
    "rejects navigation before the active leaf can change",
    rejectsNavigationBeforeTheActiveLeafCan,
  );
  it(
    "rejects a second navigation while the first is waiting",
    rejectsASecondNavigationWhileTheFirst,
  );
});
