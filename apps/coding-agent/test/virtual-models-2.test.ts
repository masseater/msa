import { type AssistantMessage, fauxAssistantMessage, getSupportedThinkingLevels } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { type ModelRouteRequest } from "../src/core/virtual-models.ts";
import virtualModelsSupport from "./virtual-models-support.ts";

const { assistantFrom, createRuntime } = virtualModelsSupport;

const { awaited, runTest } = testing;

const listsAVirtualModelAndRoutesIt = Effect.gen(function* () {
  const requests: ModelRouteRequest[] = [];
  const { runtime, virtual } = yield* awaited(createRuntime(requests));
  expect(virtual).toMatchObject({
    contextWindow: 0,
    id: "auto",
    maxTokens: 0,
    provider: "router",
  });
  expect(virtual.input).toEqual(["text", "image"]);
  expect(getSupportedThinkingLevels(virtual)).toEqual(["low", "high"]);
  const large = runtime.getModel("faux", "large")!;
  const messages = [
    { content: "first", role: "user" as const, timestamp: 1 },
    { ...assistantFrom(large, "answer"), thinkingLevel: "medium" as const },
    { content: "second", role: "user" as const, timestamp: 2 },
  ];

  const low = yield* awaited(
    runtime.resolveModel(virtual, messages, {
      reason: "user",
      thinkingLevel: "low",
    }),
  );
  expect(low.model.id).toBe("small");

  expect(low.thinkingLevel).toBe("off");
  expect(requests[0]?.previous).toEqual({ model: large, thinkingLevel: "medium" });

  const high = yield* awaited(
    runtime.resolveModel(virtual, messages, {
      reason: "user",
      thinkingLevel: "high",
    }),
  );
  expect(high).toEqual({ model: large, thinkingLevel: "high" });
});

const reportsTheFailedRequestOfARetry = Effect.gen(function* () {
  const requests: ModelRouteRequest[] = [];
  const { runtime, virtual } = yield* awaited(createRuntime(requests));
  const small = runtime.getModel("faux", "small")!;
  const large = runtime.getModel("faux", "large")!;
  const failed: AssistantMessage = {
    ...assistantFrom(large, ""),
    errorMessage: "overloaded_error",
    stopReason: "error",
    thinkingLevel: "high",
  };
  const messages = [
    { content: "first", role: "user" as const, timestamp: 1 },
    assistantFrom(small, "answer"),
    { content: "second", role: "user" as const, timestamp: 2 },
  ];

  yield* awaited(
    runtime.resolveModel(virtual, messages, {
      failed,
      reason: "retry",
      thinkingLevel: "low",
    }),
  );

  const failedRoute = { ...assistantFrom(virtual, ""), stopReason: "error" as const };
  yield* awaited(
    runtime.resolveModel(virtual, messages, {
      failed: failedRoute,
      reason: "retry",
      thinkingLevel: "low",
    }),
  );

  expect(requests[0]?.previous?.model).toBe(small);
  expect(requests[0]?.failed).toEqual({
    message: failed,
    model: large,
    thinkingLevel: "high",
  });
  const secondRequest = requests[1];
  if (secondRequest === undefined) throw new Error("expected a second routing request");
  expect(secondRequest.failed).toBeUndefined();
});

const listsSeveralVirtualModelsUnderAProvider = Effect.gen(function* () {
  const { runtime, definition } = yield* awaited(createRuntime());
  const route = () => ({
    model: runtime.getModel("faux", "small")!,
    thinkingLevel: "off" as const,
  });
  runtime.registerVirtualModel({ ...definition, id: "auto", provider: "faux", route });
  runtime.registerVirtualModel({
    ...definition,
    id: "fast",
    name: "Fast",
    provider: "faux",
    route,
  });
  runtime.registerVirtualModel({ ...definition, id: "second", name: "Second" });

  expect(runtime.getModels("faux").map((model) => model.id)).toEqual([
    "small",
    "large",
    "auto",
    "fast",
  ]);
  expect(runtime.getModels("router").map((model) => model.id)).toEqual(["auto", "second"]);

  const available = yield* awaited(runtime.getAvailable());
  expect(available.filter((model) => model.provider === "faux").map((model) => model.id)).toEqual([
    "small",
    "large",
    "auto",
    "fast",
  ]);
  const fast = runtime.getModel("faux", "fast")!;
  yield* awaited(
    expect(
      runtime.resolveModel(fast, [], { reason: "user", thinkingLevel: "off" }),
    ).resolves.toMatchObject({
      model: { id: "small", provider: "faux" },
    }),
  );

  expect(() =>
    runtime.registerVirtualModel({ ...definition, id: "large", provider: "faux" }),
  ).toThrow("conflicts with a physical model");
  runtime.unregisterVirtualModel("faux", "fast");
  runtime.unregisterVirtualModel("router", "auto");
  expect(runtime.getModels("faux").map((model) => model.id)).toEqual(["small", "large", "auto"]);
  expect(runtime.getModels("router").map((model) => model.id)).toEqual(["second"]);
});

const rejectsRoutesToVirtualOrUnknownModels = Effect.gen(function* () {
  const { runtime, definition, virtual } = yield* awaited(createRuntime());
  const unknown = { ...virtual, id: "missing", provider: "faux" };

  for (const model of [virtual, unknown]) {
    runtime.registerVirtualModel({
      ...definition,
      route: () => ({ model, thinkingLevel: "off" }),
    });
    yield* awaited(
      expect(
        runtime.resolveModel(virtual, [], { reason: "user", thinkingLevel: "low" }),
      ).rejects.toThrow("which is not a physical model"),
    );
  }
});

const routesDirectStreamsimpleCallsWithinTheRouted = Effect.gen(function* () {
  const requests: ModelRouteRequest[] = [];
  const { runtime, faux, virtual } = yield* awaited(createRuntime(requests));
  let maxTokens: number | undefined;
  faux.setResponses([
    (_context, options) => {
      maxTokens = options?.maxTokens;
      return fauxAssistantMessage("hello");
    },
  ]);

  const message = yield* awaited(
    runtime.completeSimple(
      virtual,
      { messages: [{ content: "hi", role: "user", timestamp: 1 }] },
      { maxTokens: 20_000, reasoning: "high" },
    ),
  );

  expect(requests.map((request) => request.reason)).toEqual(["direct"]);
  expect(message).toMatchObject({ model: "large", provider: "faux", stopReason: "stop" });
  expect(maxTokens).toBe(5000);
});

const doesNotForwardCallerCredentialsToA = Effect.gen(function* () {
  const { runtime, faux, definition, virtual } = yield* awaited(createRuntime());
  const seen: {
    apiKey?: string | undefined;
    headers?: Record<string, string | null> | undefined;
  }[] = [];
  const respond = (
    _context: unknown,
    options?: {
      apiKey?: string | undefined;
      headers?: Record<string, string | null> | undefined;
    },
  ) => {
    seen.push({ apiKey: options?.apiKey, headers: options?.headers });
    return fauxAssistantMessage("hello");
  };
  faux.setResponses([respond, respond]);
  const context = { messages: [{ content: "hi", role: "user" as const, timestamp: 1 }] };
  const options = { apiKey: "caller-key", headers: { "x-caller": "1" } };
  runtime.registerVirtualModel({ ...definition, id: "auto", provider: "faux" });

  yield* awaited(runtime.completeSimple(virtual, context, options));
  yield* awaited(runtime.completeSimple(runtime.getModel("faux", "auto")!, context, options));

  const [routed] = seen;
  if (routed === undefined) throw new Error("expected the routed request to be seen");
  expect(routed.apiKey).not.toBe("caller-key");
  expect(routed.headers?.["x-caller"]).toBeUndefined();
  expect(seen[1]).toMatchObject({ apiKey: "caller-key", headers: { "x-caller": "1" } });
});

const failsUnroutedStreamCallsOnVirtualModels = Effect.gen(function* () {
  const { runtime, virtual } = yield* awaited(createRuntime());

  const message = yield* awaited(
    runtime.complete(virtual, {
      messages: [{ content: "hi", role: "user", timestamp: 1 }],
    }),
  );

  expect(message.stopReason).toBe("error");
  expect(message.errorMessage).toContain("must be routed before streaming");
});

describe("ModelRuntime virtual models", () => {
  it("lists a virtual model and routes it to a physical model with a clamped thinking level", () =>
    runTest(listsAVirtualModelAndRoutesIt));

  it("reports the failed request of a retry separately from the latest successful response", () =>
    runTest(reportsTheFailedRequestOfARetry));

  it("lists several virtual models under a provider with physical models", () =>
    runTest(listsSeveralVirtualModelsUnderAProvider));

  it("rejects routes to virtual or unknown models", () =>
    runTest(rejectsRoutesToVirtualOrUnknownModels));

  it("routes direct streamSimple calls within the routed model's limits", () =>
    runTest(routesDirectStreamsimpleCallsWithinTheRouted));

  it("does not forward caller credentials to a routed model of another provider", () =>
    runTest(doesNotForwardCallerCredentialsToA));

  it("fails unrouted stream calls on virtual models", () =>
    runTest(failsUnroutedStreamCallsOnVirtualModels));
});
