import { fauxAssistantMessage } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionBoundariesSupport from "./agent-session-boundaries-support.ts";
import harnessModule from "./harness.ts";

const { harnesses } = agentSessionBoundariesSupport;

const { createHarness } = harnessModule;

const { gate } = testing;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  const promise = gate();
  return { promise, resolve: () => promise.release() };
}

const doesNotConsumeQueuedInputWhen = Effect.gen(function* () {
  let handled = false;
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_before_settle", (_event, ctx) => {
            if (handled) return;
            handled = true;
            msa.sendUserMessage("still queued", { deliverAs: "followUp" });
            const targets = ctx.sessionManager
              .getBranch()
              .flatMap((entry) =>
                entry.type === "message" &&
                (entry.message.role === "user" ||
                  entry.message.role === "assistant" ||
                  entry.message.role === "toolResult")
                  ? [entry.id]
                  : [],
              );
            return {
              continue: true,
              entries: targets.map((targetId) => ({
                replacement: null,
                targetId,
                type: "context_edit" as const,
              })),
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("must not run")]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.faux.state.callCount).toBe(1);
  expect(harness.session.pendingMessageCount).toBe(1);
});

const commitsPreSettlementDraftsButSuppresses = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const started = deferred();
  const release = deferred();
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_before_settle", () =>
            runPromise(
              Effect.gen(function* () {
                started.resolve();
                yield* Effect.promise(() => release.promise);
                return {
                  continue: true,
                  entries: [{ customType: "committed-after-abort", data: true, type: "custom" }],
                };
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("must not run")]);

  const prompt = harness.session.prompt("start");
  yield* Effect.promise(() => started.promise);
  const abort = harness.session.abort();
  release.resolve();
  yield* Effect.promise(() => Promise.all([prompt, abort]));

  expect(harness.faux.state.callCount).toBe(1);
  expect(harness.sessionManager.getEntries()).toContainEqual(
    expect.objectContaining({
      customType: "committed-after-abort",
      data: true,
      type: "custom",
    }),
  );

  expect(harness.eventsOfType("agent_settled")).toEqual([{ aborted: true, type: "agent_settled" }]);
});

const doesNotConsumeQueuedInputWhenPre = () => Effect.runPromise(doesNotConsumeQueuedInputWhen);

const commitsPreSettlementDraftsButSuppressesContinuation = () =>
  Effect.runPromise(commitsPreSettlementDraftsButSuppresses);

describe("AgentSession actionable boundaries", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "does not consume queued input when pre-settlement drafts leave system-only context",
    doesNotConsumeQueuedInputWhenPre,
  );

  it(
    "commits pre-settlement drafts but suppresses continuation when aborted during the hook",
    commitsPreSettlementDraftsButSuppressesContinuation,
  );
});
