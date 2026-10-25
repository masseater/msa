import ai from "@msa/ai";
import testing from "@msa/testing";
import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type agentSessionTypes from "../../../src/core/agent-session.types.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { cleanupAll } = harnessModule;

const { fauxAssistantMessage } = ai;

const { createHarness, getMessageText, getUserTexts } = harnessModule;

const { currentTimeMillis, gate } = testing;

const harnesses: harnessTypes.Harness[] = [];

const rejectsAnRpcPromptWhileManualSetup = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const compactionStarted = gate();
    const compactionReleased = gate();

    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("session_before_compact", (event) =>
              runPromise(
                Effect.gen(function* () {
                  compactionStarted.release();
                  yield* Effect.promise(() => compactionReleased);
                  return {
                    compaction: {
                      details: {},
                      firstKeptEntryId: event.preparation.firstKeptEntryId,
                      summary: "manual compacted",
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
    harnesses.push(harness);

    const timestamp = currentTimeMillis();
    harness.sessionManager.appendMessage({
      content: [{ text: "old user message", type: "text" }],
      role: "user",
      timestamp: timestamp - 1000,
    });
    harness.sessionManager.appendMessage(
      fauxAssistantMessage("old assistant response", { timestamp: timestamp - 500 }),
    );
    harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
    return { compactionReleased, compactionStarted, harness };
  });

const rejectsAnRpcPromptWhileManual = Effect.gen(function* () {
  const { compactionReleased, compactionStarted, harness } =
    yield* rejectsAnRpcPromptWhileManualSetup();
  harness.setResponses([fauxAssistantMessage("probe response")]);

  const compactPromise = harness.session.compaction.manual.compact();
  yield* Effect.promise(() => compactionStarted);

  let preflightResult: agentSessionTypes.PromptDisposition | undefined;
  let promptError: unknown;
  try {
    const tryExit6 = yield* Effect.exit(
      Effect.promise(() =>
        harness.session.run.prompting.prompt("PROBE-7150", {
          preflightResult: (result) => {
            preflightResult = result;
          },
          source: "rpc",
        }),
      ),
    );
    if (Exit.isFailure(tryExit6)) {
      const error = Cause.squash(tryExit6.cause);
      promptError = error;
    }
  } finally {
    compactionReleased.release();
    yield* Effect.promise(() => compactPromise);
  }

  const persistedUserTexts = harness.sessionManager
    .getEntries()
    .flatMap((entry) =>
      entry.type === "message" && entry.message.role === "user"
        ? [getMessageText(entry.message)]
        : [],
    );

  expect(preflightResult).toBeUndefined();
  expect(promptError).toEqual(
    expect.objectContaining({
      message: expect.stringContaining("compaction is in progress"),
    }),
  );
  expect(getUserTexts(harness)).not.toContain("PROBE-7150");
  expect(persistedUserTexts).not.toContain("PROBE-7150");
  expect(harness.eventsOfType("agent_start")).toHaveLength(0);
  expect(harness.eventsOfType("agent_settled")).toHaveLength(0);
});

const rejectsAnRpcPromptWhileManualCompaction = () =>
  Effect.runPromise(rejectsAnRpcPromptWhileManual);

const afterEachHook = () => cleanupAll(harnesses);

describe("issue #7150: RPC prompt during manual compaction", () => {
  afterEach(afterEachHook);
  it(
    "rejects an RPC prompt while manual compaction is in progress",
    rejectsAnRpcPromptWhileManualCompaction,
  );
});
