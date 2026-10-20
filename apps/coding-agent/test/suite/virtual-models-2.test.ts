import { type FauxResponseStep, fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { VIRTUAL_MODEL_STATE_ENTRY } from "../../src/core/virtual-models.ts";
import virtualModelsSupport from "./virtual-models-support.ts";
import type virtualModelsSupportTypes from "./virtual-models-support.types.ts";

const { createRoutedHarness, defaultRoute, harnesses } = virtualModelsSupport;

const compactsBeforeARequestRoutedTo = Effect.gen(function* () {
  const { harness, dispatched } = yield* Effect.promise(() =>
    createRoutedHarness(defaultRoute, {
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", ({ preparation: { firstKeptEntryId, tokensBefore } }) =>
            Promise.resolve({
              compaction: { firstKeptEntryId, summary: "compacted", tokensBefore },
            }),
          );
        },
      ],
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
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
  const route: virtualModelsSupportTypes.Route = (request, ctx) =>
    request.reason === "continuation"
      ? { model: ctx.modelRegistry.find("faux", "small")!, thinkingLevel: "off" }
      : defaultRoute(request, ctx);
  const { harness, dispatched } = yield* Effect.promise(() =>
    createRoutedHarness(route, {
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", ({ preparation: { firstKeptEntryId, tokensBefore } }) =>
            Promise.resolve({
              compaction: { firstKeptEntryId, summary: "compacted", tokensBefore },
            }),
          );
        },
      ],
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
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
    { modelId: "auto", provider: "router", state: { turns: 1 } },
    { modelId: "auto", provider: "router", state: { turns: 2 } },
  ]);

  yield* Effect.promise(() => harness.session.compact());

  expect(reasons()).toEqual(["user", "continuation", "user", "direct"]);
  expect(states).toEqual([undefined, { turns: 1 }, { turns: 1 }, undefined]);
  expect(stored()).toHaveLength(2);
});

const doesNotRouteCompactionsThatAn = Effect.gen(function* () {
  const route: virtualModelsSupportTypes.Route = (request, ctx) => {
    if (request.reason === "direct") throw new Error("router unavailable");
    return defaultRoute(request, ctx);
  };
  const { harness, reasons } = yield* Effect.promise(() =>
    createRoutedHarness(route, {
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", ({ preparation: { firstKeptEntryId, tokensBefore } }) =>
            Promise.resolve({
              compaction: { firstKeptEntryId, summary: "extension summary", tokensBefore },
            }),
          );
        },
      ],
      settings: { compaction: { keepRecentTokens: 1 } },
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

const compactsBeforeARequestRoutedToA = () => Effect.runPromise(compactsBeforeARequestRoutedTo);

const compactsBetweenTurnsOfARunWhen = () => Effect.runPromise(compactsBetweenTurnsOfARun);

const projectsTheSessionOncePerRequestUnder = () =>
  Effect.runPromise(projectsTheSessionOncePerRequest);

const storesRouterStateOnTheBranchAnd = () => Effect.runPromise(storesRouterStateOnTheBranch);

const doesNotRouteCompactionsThatAnExtension = () =>
  Effect.runPromise(doesNotRouteCompactionsThatAn);

const routesCompactionSummariesBeforeSizingThem2 = () =>
  Effect.runPromise(routesCompactionSummariesBeforeSizingThem);

describe("AgentSession virtual models", () => {
  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.cleanup();
  });

  it(
    "compacts before a request routed to a model with a smaller window",
    compactsBeforeARequestRoutedToA,
  );

  it(
    "compacts between turns of a run when the next request is routed to a smaller window",
    compactsBetweenTurnsOfARunWhen,
  );

  it(
    "projects the session once per request under a virtual selection",
    projectsTheSessionOncePerRequestUnder,
  );

  it(
    "stores router state on the branch and passes it to later requests",
    storesRouterStateOnTheBranchAnd,
  );

  it(
    "does not route compactions that an extension supplies",
    doesNotRouteCompactionsThatAnExtension,
  );

  it("routes compaction summaries before sizing them", routesCompactionSummariesBeforeSizingThem2);
});
