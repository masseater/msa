import { fauxAssistantMessage } from "@msa/ai";
import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { PromptDisposition } from "../../../src/core/agent-session.ts";
import { nowMillis } from "../../test-time.ts";
import { createHarness, getMessageText, getUserTexts, type Harness } from "../harness.ts";

const harnesses: Harness[] = [];

const rejectsAnRpcPromptWhileManual = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let markCompactionStarted = () => {};
  const compactionStarted = new Promise<void>((resolve) => {
    markCompactionStarted = resolve;
  });
  let releaseCompaction = () => {};
  const compactionReleased = new Promise<void>((resolve) => {
    releaseCompaction = resolve;
  });

  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { compaction: { keepRecentTokens: 1 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            runPromise(
              Effect.gen(function* () {
                markCompactionStarted();
                yield* Effect.promise(() => compactionReleased);
                return {
                  compaction: {
                    summary: "manual compacted",
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
  harnesses.push(harness);

  const timestamp = nowMillis();
  harness.sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "old user message" }],
    timestamp: timestamp - 1000,
  });
  harness.sessionManager.appendMessage(
    fauxAssistantMessage("old assistant response", { timestamp: timestamp - 500 }),
  );
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
  harness.setResponses([fauxAssistantMessage("probe response")]);

  const compactPromise = harness.session.compact();
  yield* Effect.promise(() => compactionStarted);

  let preflightResult: PromptDisposition | undefined;
  let promptError: unknown;
  try {
    const tryExit6 = yield* Effect.exit(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          harness.session.prompt("PROBE-7150", {
            source: "rpc",
            preflightResult: (result) => {
              preflightResult = result;
            },
          }),
        );
      }),
    );
    if (Exit.isFailure(tryExit6)) {
      const error = Cause.squash(tryExit6.cause);
      promptError = error;
    }
  } finally {
    releaseCompaction();
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

describe("issue #7150: RPC prompt during manual compaction", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("rejects an RPC prompt while manual compaction is in progress", () =>
    Effect.runPromise(rejectsAnRpcPromptWhileManual));
});
