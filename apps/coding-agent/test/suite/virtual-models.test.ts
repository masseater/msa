import type { AgentTool } from "@msa/agent-core";
import { type FauxResponseStep, fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { currentTimeMillis } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ExtensionContext } from "../../src/core/extensions/index.ts";
import {
  type ModelRoute,
  type ModelRouteRequest,
  VIRTUAL_MODEL_STATE_ENTRY,
} from "../../src/core/virtual-models.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

const echoTool: AgentTool = {
  name: "echo",
  label: "Echo",
  description: "Echo text back",
  parameters: Type.Object({ text: Type.String() }),
  execute: () => Promise.resolve({ content: [{ type: "text", text: "echoed" }], details: {} }),
};

type Route = (request: ModelRouteRequest, ctx: ExtensionContext) => ModelRoute;

const defaultRoute: Route = (request, ctx) => {
  const find = (id: string) => ctx.modelRegistry.find("faux", id)!;
  if (request.reason === "direct") return { model: find("large"), thinkingLevel: "low" };
  const sticky = request.failed ?? request.previous;
  if (request.reason !== "user" && sticky !== undefined) {
    return { model: sticky.model, thinkingLevel: sticky.thinkingLevel ?? "high" };
  }
  return request.thinkingLevel === "high"
    ? { model: find("large"), thinkingLevel: "high" }
    : { model: find("small"), thinkingLevel: "off" };
};

const harnesses: Harness[] = [];

function createRoutedHarness(route: Route = defaultRoute, options: HarnessOptions = {}) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const requests: ModelRouteRequest[] = [];
      const harness = yield* Effect.promise(() =>
        createHarness({
          ...options,
          models: [
            { id: "small", contextWindow: 1000 },
            { id: "large", contextWindow: 50_000, maxTokens: 4000, reasoning: true },
          ],
          tools: [echoTool],
          extensionFactories: [
            ...(options.extensionFactories ?? []),
            (msa) => {
              msa.registerVirtualModel({
                provider: "router",
                id: "auto",
                name: "Auto",
                thinkingLevels: ["low", "high"],
                contextWindow: 1000,
                route(request, ctx) {
                  requests.push(request);
                  return route(request, ctx);
                },
              });
            },
          ],
        }),
      );
      harnesses.push(harness);

      const runtime = harness.session.modelRuntime;
      harness.session.agent.streamFunction = (model, context, options) =>
        runtime.streamSimple(model, context, options);
      yield* Effect.promise(() => harness.session.setModel(runtime.getModel("router", "auto")!));
      harness.session.setThinkingLevel("high");
      const reasons = () => requests.map((request) => request.reason);

      const dispatched = () =>
        harness.session.messages.flatMap((message) =>
          message.role === "assistant"
            ? [`${message.provider}/${message.model}:${message.thinkingLevel}`]
            : [],
        );
      return { harness, requests, reasons, dispatched };
    }),
  );
}

const routesEachRequestIncludingRetriesWhile = Effect.gen(function* () {
  const { harness, requests, reasons, dispatched } = yield* Effect.promise(() =>
    createRoutedHarness(defaultRoute, {
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    }),
  );
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage(fauxToolCall("echo", { text: "hi" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("hello"));

  expect(reasons()).toEqual(["user", "retry", "continuation"]);
  expect(requests[1]?.failed?.message.errorMessage).toBe("overloaded_error");
  expect(requests[2]?.previous?.model.id).toBe("large");
  expect(dispatched()).toEqual(["faux/large:high", "faux/large:high"]);
  expect(harness.session.model).toMatchObject({ provider: "router", id: "auto" });
  expect(harness.session.thinkingLevel).toBe("high");

  expect(harness.session.getContextUsage()?.contextWindow).toBe(50_000);
});

const retriesTheFirstRequestOfA = Effect.gen(function* () {
  const { harness, requests, reasons, dispatched } = yield* Effect.promise(() =>
    createRoutedHarness(defaultRoute, {
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    }),
  );
  harness.session.setThinkingLevel("low");
  harness.setResponses([
    fauxAssistantMessage("easy answer"),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("hard answer"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("easy"));
  harness.session.setThinkingLevel("high");

  yield* Effect.promise(() => harness.session.prompt("hard"));

  expect(reasons()).toEqual(["user", "user", "retry"]);

  expect(requests[2]?.failed?.model.id).toBe("large");
  expect(requests[2]?.previous?.model.id).toBe("small");
  expect(dispatched()).toEqual(["faux/small:off", "faux/large:high"]);
});

const routesTheCompactAndRetryAfter = Effect.gen(function* () {
  const { harness, requests, reasons } = yield* Effect.promise(() =>
    createRoutedHarness(defaultRoute, {
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", ({ preparation: { firstKeptEntryId, tokensBefore } }) =>
            Promise.resolve({
              compaction: { summary: "overflow compacted", firstKeptEntryId, tokensBefore },
            }),
          );
        },
      ],
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

  yield* Effect.promise(() => harness.session.prompt("x".repeat(5000)));

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
              entries: [
                {
                  type: "custom_message",
                  customType: "nudge",
                  content: "Keep going.",
                  display: false,
                },
              ],
              continue: true,
            };
          });
        },
      ],
    }),
  );
  harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

  yield* Effect.promise(() => harness.session.prompt("hello"));

  expect(reasons()).toEqual(["user", "continuation"]);
});

const routesTheFirstRequestOfA = Effect.gen(function* () {
  const { harness, reasons } = yield* Effect.promise(() =>
    createRoutedHarness(defaultRoute, {
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", () => ({
            message: { customType: "context", content: "Extra context.", display: false },
          }));
        },
      ],
    }),
  );
  harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

  yield* Effect.promise(() => harness.session.prompt("hello"));
  yield* Effect.promise(() => harness.session.prompt("again"));

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
  yield* Effect.promise(() => harness.session.prompt("hello"));

  fail = true;
  yield* Effect.promise(() => harness.session.prompt("again"));

  expect(harness.session.messages.at(-1)).toMatchObject({
    role: "assistant",
    provider: "router",
    model: "auto",
    stopReason: "error",
    errorMessage: expect.stringContaining("router unavailable"),
  });
  expect(harness.faux.state.callCount).toBe(1);

  expect(harness.session.getContextUsage()?.contextWindow).toBe(50_000);
});

const checksCompactionAgainstThePhysicalModel = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => createRoutedHarness());
  harness.setResponses([fauxAssistantMessage("short answer"), fauxAssistantMessage("long answer")]);
  yield* Effect.promise(() => harness.session.prompt("hello"));

  yield* Effect.promise(() => harness.session.prompt("x".repeat(80_000)));

  expect(harness.eventsOfType("compaction_start")).toHaveLength(0);
});

const compactsBeforeARequestRoutedTo = Effect.gen(function* () {
  const { harness, dispatched } = yield* Effect.promise(() =>
    createRoutedHarness(defaultRoute, {
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", ({ preparation: { firstKeptEntryId, tokensBefore } }) =>
            Promise.resolve({
              compaction: { summary: "compacted", firstKeptEntryId, tokensBefore },
            }),
          );
        },
      ],
    }),
  );
  let compactedBeforeSmall = false;
  harness.setResponses([
    fauxAssistantMessage("y".repeat(8000)),
    () => {
      compactedBeforeSmall = harness.eventsOfType("compaction_end").length === 1;
      return fauxAssistantMessage("small answer");
    },
  ]);
  yield* Effect.promise(() => harness.session.prompt("hello"));
  expect(harness.eventsOfType("compaction_start")).toHaveLength(0);

  harness.session.setThinkingLevel("low");
  yield* Effect.promise(() => harness.session.prompt("next"));

  expect(harness.eventsOfType("compaction_start").map((event) => event.reason)).toEqual([
    "threshold",
  ]);
  expect(compactedBeforeSmall).toBe(true);
  expect(dispatched().at(-1)).toBe("faux/small:off");
});

const compactsBetweenTurnsOfARun = Effect.gen(function* () {
  const route: Route = (request, ctx) =>
    request.reason === "continuation"
      ? { model: ctx.modelRegistry.find("faux", "small")!, thinkingLevel: "off" }
      : defaultRoute(request, ctx);
  const { harness, dispatched } = yield* Effect.promise(() =>
    createRoutedHarness(route, {
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", ({ preparation: { firstKeptEntryId, tokensBefore } }) =>
            Promise.resolve({
              compaction: { summary: "compacted", firstKeptEntryId, tokensBefore },
            }),
          );
        },
      ],
    }),
  );
  let compactedBeforeSmall = false;
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("echo", { text: "hi" }), { stopReason: "toolUse" }),
    () => {
      compactedBeforeSmall = harness.eventsOfType("compaction_end").length === 1;
      return fauxAssistantMessage("small answer");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("x".repeat(8000)));

  expect(harness.eventsOfType("compaction_start").map((event) => event.reason)).toEqual([
    "threshold",
  ]);
  expect(compactedBeforeSmall).toBe(true);
  expect(dispatched()).toEqual(["faux/large:high", "faux/small:off"]);
});

const projectsTheSessionOncePerRequest = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => createRoutedHarness());
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("echo", { text: "hi" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const projections = vi.spyOn(harness.sessionManager, "buildSessionProjection");

  yield* Effect.promise(() => harness.session.prompt("hello"));

  expect(projections).toHaveBeenCalledTimes(4);
});

const storesRouterStateOnTheBranch = Effect.gen(function* () {
  const states: unknown[] = [];
  const { harness, reasons } = yield* Effect.promise(() =>
    createRoutedHarness(
      (request, ctx) => {
        states.push(request.state);
        const turns = (request.state as { turns: number } | undefined)?.turns ?? 0;
        const route = defaultRoute(request, ctx);

        if (request.reason === "continuation") return { ...route, state: request.state };
        return { ...route, state: { turns: turns + 1 } };
      },
      { settings: { compaction: { keepRecentTokens: 1 } } },
    ),
  );
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("echo", { text: "hi" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("first"),
    fauxAssistantMessage("second"),
    fauxAssistantMessage("summary"),
    fauxAssistantMessage("summary"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("one"));
  yield* Effect.promise(() => harness.session.prompt("two"));
  const stored = () =>
    harness.sessionManager
      .getBranch()
      .flatMap((entry) =>
        entry.type === "custom" && entry.customType === VIRTUAL_MODEL_STATE_ENTRY
          ? [entry.data]
          : [],
      );
  expect(stored()).toEqual([
    { provider: "router", modelId: "auto", state: { turns: 1 } },
    { provider: "router", modelId: "auto", state: { turns: 2 } },
  ]);

  yield* Effect.promise(() => harness.session.compact());

  expect(reasons()).toEqual(["user", "continuation", "user", "direct"]);
  expect(states).toEqual([undefined, { turns: 1 }, { turns: 1 }, undefined]);
  expect(stored()).toHaveLength(2);
});

const doesNotRouteCompactionsThatAn = Effect.gen(function* () {
  const route: Route = (request, ctx) => {
    if (request.reason === "direct") throw new Error("router unavailable");
    return defaultRoute(request, ctx);
  };
  const { harness, reasons } = yield* Effect.promise(() =>
    createRoutedHarness(route, {
      settings: { compaction: { keepRecentTokens: 1 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", ({ preparation: { firstKeptEntryId, tokensBefore } }) =>
            Promise.resolve({
              compaction: { summary: "extension summary", firstKeptEntryId, tokensBefore },
            }),
          );
        },
      ],
    }),
  );
  harness.setResponses([
    fauxAssistantMessage("first answer"),
    fauxAssistantMessage("second answer"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("first"));
  yield* Effect.promise(() => harness.session.prompt("second"));

  const result = yield* Effect.promise(() => harness.session.compact());

  expect(result.summary).toBe("extension summary");
  expect(reasons()).toEqual(["user", "user"]);
});

const routesCompactionSummariesBeforeSizingThem = Effect.gen(function* () {
  const summaries: string[] = [];
  const { harness, reasons } = yield* Effect.promise(() =>
    createRoutedHarness(defaultRoute, {
      settings: { compaction: { keepRecentTokens: 1 } },
    }),
  );
  const summary: FauxResponseStep = (_context, options, _state, model) => {
    summaries.push(`${model.id}:${options?.reasoning ?? "off"}:${options?.maxTokens}`);
    return fauxAssistantMessage("summary");
  };

  harness.setResponses([
    fauxAssistantMessage("first answer"),
    fauxAssistantMessage("second answer"),
    summary,
    summary,
  ]);
  yield* Effect.promise(() => harness.session.prompt("first"));
  yield* Effect.promise(() => harness.session.prompt("second"));

  const result = yield* Effect.promise(() => harness.session.compact());

  expect(result.summary).toContain("summary");
  expect(reasons()).toEqual(["user", "user", "direct"]);

  expect(summaries).toEqual(["large:low:4000", "large:low:4000"]);
});

describe("AgentSession virtual models", () => {
  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.cleanup();
  });
  it("routes each request, including retries, while the selection stays virtual", () =>
    Effect.runPromise(routesEachRequestIncludingRetriesWhile));
  it("retries the first request of a turn on the model routed for that turn", () =>
    Effect.runPromise(retriesTheFirstRequestOfA));
  it("routes the compact-and-retry after a truncated response as a retry", () =>
    Effect.runPromise(routesTheCompactAndRetryAfter));
  it("routes requests after extension messages as continuations", () =>
    Effect.runPromise(routesRequestsAfterExtensionMessagesAs));
  it("routes the first request of a prompt as a user turn when extension messages follow the prompt", () =>
    Effect.runPromise(routesTheFirstRequestOfA));
  it("ends the run with an error response when routing fails and keeps the last physical limits", () =>
    Effect.runPromise(endsTheRunWithAnError));
  it("checks compaction against the physical model that produced the response", () =>
    Effect.runPromise(checksCompactionAgainstThePhysicalModel));
  it("compacts before a request routed to a model with a smaller window", () =>
    Effect.runPromise(compactsBeforeARequestRoutedTo));
  it("compacts between turns of a run when the next request is routed to a smaller window", () =>
    Effect.runPromise(compactsBetweenTurnsOfARun));
  it("projects the session once per request under a virtual selection", () =>
    Effect.runPromise(projectsTheSessionOncePerRequest));
  it("stores router state on the branch and passes it to later requests", () =>
    Effect.runPromise(storesRouterStateOnTheBranch));
  it("does not route compactions that an extension supplies", () =>
    Effect.runPromise(doesNotRouteCompactionsThatAn));
  it("routes compaction summaries before sizing them", () =>
    Effect.runPromise(routesCompactionSummariesBeforeSizingThem));
});
