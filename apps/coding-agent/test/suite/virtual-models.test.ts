import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import virtualModelsSupport from "./virtual-models-support.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createRoutedHarness, defaultRoute, harnesses } = virtualModelsSupport;

const { currentTimeMillis } = testing;

const routesEachRequestIncludingRetriesWhile = Effect.gen(function* () {
  const { harness, requests, reasons, dispatched } = yield* Effect.promise(() =>
    createRoutedHarness(defaultRoute, {
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
    }),
  );
  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage(fauxToolCall("echo", { text: "hi" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));

  expect(reasons()).toEqual(["user", "retry", "continuation"]);
  expect(requests[1]?.failed?.message.errorMessage).toBe("overloaded_error");
  expect(requests[2]?.previous?.model.id).toBe("large");
  expect(dispatched()).toEqual(["faux/large:high", "faux/large:high"]);
  expect(harness.session.model).toMatchObject({ id: "auto", provider: "router" });
  expect(harness.session.thinkingLevel).toBe("high");

  expect(harness.session.context.stats.getContextUsage()?.contextWindow).toBe(50_000);
});

const retriesTheFirstRequestOfA = Effect.gen(function* () {
  const { harness, requests, reasons, dispatched } = yield* Effect.promise(() =>
    createRoutedHarness(defaultRoute, {
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
    }),
  );
  harness.session.models.thinking.setThinkingLevel("low");
  harness.setResponses([
    fauxAssistantMessage("easy answer"),
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage("hard answer"),
  ]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("easy"));
  harness.session.models.thinking.setThinkingLevel("high");

  yield* Effect.promise(() => harness.session.run.prompting.prompt("hard"));

  expect(reasons()).toEqual(["user", "user", "retry"]);

  expect(requests[2]?.failed?.model.id).toBe("large");
  expect(requests[2]?.previous?.model.id).toBe("small");
  expect(dispatched()).toEqual(["faux/small:off", "faux/large:high"]);
});

const routesTheCompactAndRetryAfter = Effect.gen(function* () {
  const { harness, requests, reasons } = yield* Effect.promise(() =>
    createRoutedHarness(defaultRoute, {
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", ({ preparation: { firstKeptEntryId, tokensBefore } }) =>
            Promise.resolve({
              compaction: { firstKeptEntryId, summary: "overflow compacted", tokensBefore },
            }),
          );
        },
      ],
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
    }),
  );
  harness.setResponses([
    () =>
      fauxAssistantMessage("x".repeat(64), {
        stopReason: "length",
        timestamp: currentTimeMillis() + 10_000,
      }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("x".repeat(5000)));

  expect(harness.eventsOfType("compaction_start").map((event) => event.reason)).toEqual([
    "overflow",
  ]);

  expect(reasons()).toEqual(["user", "retry"]);
  expect(requests[1]?.failed?.model.id).toBe("large");
  expect(requests[1]?.failed?.message.stopReason).toBe("length");
});

const routesRequestsAfterExtensionMessagesAs = Effect.gen(function* () {
  const { harness, reasons } = yield* Effect.promise(() =>
    createRoutedHarness(defaultRoute, {
      extensionFactories: [
        (msa) => {
          let continued = false;
          msa.on("agent_before_settle", () => {
            if (continued) return undefined;
            continued = true;
            return {
              continue: true,
              entries: [
                {
                  content: "Keep going.",
                  customType: "nudge",
                  display: false,
                  type: "custom_message",
                },
              ],
            };
          });
        },
      ],
    }),
  );
  harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));

  expect(reasons()).toEqual(["user", "continuation"]);
});

const routesTheFirstRequestOfA = Effect.gen(function* () {
  const { harness, reasons } = yield* Effect.promise(() =>
    createRoutedHarness(defaultRoute, {
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", () => ({
            message: { content: "Extra context.", customType: "context", display: false },
          }));
        },
      ],
    }),
  );
  harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));
  yield* Effect.promise(() => harness.session.run.prompting.prompt("again"));

  expect(harness.session.messages.at(-2)?.role).toBe("custom");
  expect(reasons()).toEqual(["user", "user"]);
});

const endsTheRunWithAnError = Effect.gen(function* () {
  let fail = false;
  const { harness } = yield* Effect.promise(() =>
    createRoutedHarness((request, ctx) => {
      if (fail) throw new Error("router unavailable");
      return defaultRoute(request, ctx);
    }),
  );
  harness.setResponses([fauxAssistantMessage("answer")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));

  fail = true;
  yield* Effect.promise(() => harness.session.run.prompting.prompt("again"));

  expect(harness.session.messages.at(-1)).toMatchObject({
    errorMessage: expect.stringContaining("router unavailable"),
    model: "auto",
    provider: "router",
    role: "assistant",
    stopReason: "error",
  });
  expect(harness.faux.state.callCount).toBe(1);

  expect(harness.session.context.stats.getContextUsage()?.contextWindow).toBe(50_000);
});

const checksCompactionAgainstThePhysicalModel = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => createRoutedHarness());
  harness.setResponses([fauxAssistantMessage("short answer"), fauxAssistantMessage("long answer")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));

  yield* Effect.promise(() => harness.session.run.prompting.prompt("x".repeat(80_000)));

  expect(harness.eventsOfType("compaction_start")).toHaveLength(0);
});

const routesEachRequestIncludingRetriesWhileThe = () =>
  Effect.runPromise(routesEachRequestIncludingRetriesWhile);

const retriesTheFirstRequestOfATurn = () => Effect.runPromise(retriesTheFirstRequestOfA);

const routesTheCompactAndRetryAfterA = () => Effect.runPromise(routesTheCompactAndRetryAfter);

const routesRequestsAfterExtensionMessagesAsContinuations = () =>
  Effect.runPromise(routesRequestsAfterExtensionMessagesAs);

const routesTheFirstRequestOfAPrompt = () => Effect.runPromise(routesTheFirstRequestOfA);

const endsTheRunWithAnErrorResponse = () => Effect.runPromise(endsTheRunWithAnError);

const checksCompactionAgainstThePhysicalModelThat = () =>
  Effect.runPromise(checksCompactionAgainstThePhysicalModel);

describe("AgentSession virtual models", () => {
  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.cleanup();
  });

  it(
    "routes each request, including retries, while the selection stays virtual",
    routesEachRequestIncludingRetriesWhileThe,
  );

  it(
    "retries the first request of a turn on the model routed for that turn",
    retriesTheFirstRequestOfATurn,
  );

  it(
    "routes the compact-and-retry after a truncated response as a retry",
    routesTheCompactAndRetryAfterA,
  );

  it(
    "routes requests after extension messages as continuations",
    routesRequestsAfterExtensionMessagesAsContinuations,
  );

  it(
    "routes the first request of a prompt as a user turn when extension messages follow the prompt",
    routesTheFirstRequestOfAPrompt,
  );

  it(
    "ends the run with an error response when routing fails and keeps the last physical limits",
    endsTheRunWithAnErrorResponse,
  );

  it(
    "checks compaction against the physical model that produced the response",
    checksCompactionAgainstThePhysicalModelThat,
  );
});
