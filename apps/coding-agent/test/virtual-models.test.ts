import {
  type AssistantMessage,
  fauxAssistantMessage,
  fauxProvider,
  getSupportedThinkingLevels,
  InMemoryModelsStore,
  type Model,
} from "@msa/ai";
import { awaited, makeTempDir, removePath, runTest } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  getBranchSelection,
  type ModelRouteRequest,
  type VirtualModelDefinition,
} from "../src/core/virtual-models.ts";
import { createTestResourceLoader } from "./utilities.ts";

function createRuntime(requests: ModelRouteRequest[] = []) {
  return runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        ModelRuntime.create({
          credentials: AuthStorage.inMemory(),
          modelsStore: new InMemoryModelsStore(),
          modelsPath: null,
          allowModelNetwork: false,
        }),
      );
      const faux = fauxProvider({
        models: [
          { id: "small", contextWindow: 1000, maxTokens: 100, input: ["text"] },
          {
            id: "large",
            contextWindow: 50_000,
            maxTokens: 5000,
            input: ["text", "image"],
            reasoning: true,
          },
        ],
      });
      runtime.registerNativeProvider(faux.provider);
      const definition: VirtualModelDefinition = {
        provider: "router",
        id: "auto",
        name: "Auto",
        thinkingLevels: ["low", "high"],
        route(request) {
          requests.push(request);
          const model = runtime.getModel(
            "faux",
            request.thinkingLevel === "high" ? "large" : "small",
          )!;
          return { model, thinkingLevel: "high" };
        },
      };
      runtime.registerVirtualModel(definition);
      yield* awaited(runtime.refresh({ allowNetwork: false }));
      return yield* awaited({
        runtime,
        faux,
        definition,
        virtual: runtime.getModel("router", "auto")!,
      });
    }),
  );
}

function assistantFrom(model: Model<string>, text: string): AssistantMessage {
  return {
    ...fauxAssistantMessage(text),
    api: model.api,
    provider: model.provider,
    model: model.id,
  };
}

describe("getBranchSelection", () => {
  function select(build: (sessionManager: SessionManager) => void, runtime: ModelRuntime) {
    const sessionManager = SessionManager.inMemory();
    build(sessionManager);
    const lookups: string[] = [];
    const selection = getBranchSelection(sessionManager.getBranch(), (provider, modelId) => {
      lookups.push(`${provider}/${modelId}`);
      return runtime.getModel(provider, modelId);
    });
    return { selection, lookups };
  }

  it("looks up only the last model_change", () =>
    runTest(
      Effect.gen(function* () {
        const { runtime, virtual } = yield* awaited(createRuntime());
        const small = runtime.getModel("faux", "small")!;
        const large = runtime.getModel("faux", "large")!;

        const physical = select((sessionManager) => {
          sessionManager.appendModelChange(small.provider, small.id);
          for (let i = 0; i < 100; i++) sessionManager.appendMessage(assistantFrom(large, "ok"));
        }, runtime);
        expect(physical.selection).toEqual({ provider: "faux", modelId: "large" });
        expect(physical.lookups).toEqual(["faux/small"]);

        const routed = select((sessionManager) => {
          sessionManager.appendModelChange(small.provider, small.id);
          sessionManager.appendMessage(assistantFrom(small, "ok"));
          sessionManager.appendModelChange(virtual.provider, virtual.id);
          for (let i = 0; i < 100; i++) sessionManager.appendMessage(assistantFrom(large, "ok"));
        }, runtime);
        expect(routed.selection).toEqual({ provider: "router", modelId: "auto" });
        expect(routed.lookups).toEqual(["router/auto"]);
      }),
    ));

  it("uses the last model_change without responses after it", () =>
    runTest(
      Effect.gen(function* () {
        const { runtime, virtual } = yield* awaited(createRuntime());
        const small = runtime.getModel("faux", "small")!;
        const { selection, lookups } = select((sessionManager) => {
          sessionManager.appendModelChange(virtual.provider, virtual.id);
          sessionManager.appendMessage(assistantFrom(small, "ok"));
          sessionManager.appendModelChange(small.provider, small.id);
        }, runtime);
        expect(selection).toEqual({ provider: "faux", modelId: "small" });
        expect(lookups).toEqual([]);
      }),
    ));

  it("uses the latest physical response without a model_change", () =>
    runTest(
      Effect.gen(function* () {
        const { runtime, virtual } = yield* awaited(createRuntime());
        const small = runtime.getModel("faux", "small")!;
        const large = runtime.getModel("faux", "large")!;
        const { selection, lookups } = select((sessionManager) => {
          sessionManager.appendMessage(assistantFrom(small, "ok"));
          sessionManager.appendMessage(assistantFrom(large, "ok"));

          sessionManager.appendMessage({ ...assistantFrom(virtual, ""), stopReason: "error" });
        }, runtime);
        expect(selection).toEqual({ provider: "faux", modelId: "large" });
        expect(lookups).toEqual([]);
      }),
    ));
});

describe("ModelRuntime virtual models", () => {
  it("lists a virtual model and routes it to a physical model with a clamped thinking level", () =>
    runTest(
      Effect.gen(function* () {
        const requests: ModelRouteRequest[] = [];
        const { runtime, virtual } = yield* awaited(createRuntime(requests));
        expect(virtual).toMatchObject({
          provider: "router",
          id: "auto",
          contextWindow: 0,
          maxTokens: 0,
        });
        expect(virtual.input).toEqual(["text", "image"]);
        expect(getSupportedThinkingLevels(virtual)).toEqual(["low", "high"]);
        const large = runtime.getModel("faux", "large")!;
        const messages = [
          { role: "user" as const, content: "first", timestamp: 1 },
          { ...assistantFrom(large, "answer"), thinkingLevel: "medium" as const },
          { role: "user" as const, content: "second", timestamp: 2 },
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
      }),
    ));

  it("reports the failed request of a retry separately from the latest successful response", () =>
    runTest(
      Effect.gen(function* () {
        const requests: ModelRouteRequest[] = [];
        const { runtime, virtual } = yield* awaited(createRuntime(requests));
        const small = runtime.getModel("faux", "small")!;
        const large = runtime.getModel("faux", "large")!;
        const failed: AssistantMessage = {
          ...assistantFrom(large, ""),
          thinkingLevel: "high",
          stopReason: "error",
          errorMessage: "overloaded_error",
        };
        const messages = [
          { role: "user" as const, content: "first", timestamp: 1 },
          assistantFrom(small, "answer"),
          { role: "user" as const, content: "second", timestamp: 2 },
        ];

        yield* awaited(
          runtime.resolveModel(virtual, messages, {
            reason: "retry",
            thinkingLevel: "low",
            failed,
          }),
        );

        const failedRoute = { ...assistantFrom(virtual, ""), stopReason: "error" as const };
        yield* awaited(
          runtime.resolveModel(virtual, messages, {
            reason: "retry",
            thinkingLevel: "low",
            failed: failedRoute,
          }),
        );

        expect(requests[0]?.previous?.model).toBe(small);
        expect(requests[0]?.failed).toEqual({
          model: large,
          thinkingLevel: "high",
          message: failed,
        });
        const secondRequest = requests[1];
        if (secondRequest === undefined) throw new Error("expected a second routing request");
        expect(secondRequest.failed).toBeUndefined();
      }),
    ));

  it("lists several virtual models under a provider with physical models", () =>
    runTest(
      Effect.gen(function* () {
        const { runtime, definition } = yield* awaited(createRuntime());
        const route = () => ({
          model: runtime.getModel("faux", "small")!,
          thinkingLevel: "off" as const,
        });
        runtime.registerVirtualModel({ ...definition, provider: "faux", id: "auto", route });
        runtime.registerVirtualModel({
          ...definition,
          provider: "faux",
          id: "fast",
          name: "Fast",
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
        expect(
          available.filter((model) => model.provider === "faux").map((model) => model.id),
        ).toEqual(["small", "large", "auto", "fast"]);
        const fast = runtime.getModel("faux", "fast")!;
        yield* awaited(
          expect(
            runtime.resolveModel(fast, [], { reason: "user", thinkingLevel: "off" }),
          ).resolves.toMatchObject({
            model: { provider: "faux", id: "small" },
          }),
        );

        expect(() =>
          runtime.registerVirtualModel({ ...definition, provider: "faux", id: "large" }),
        ).toThrow("conflicts with a physical model");
        runtime.unregisterVirtualModel("faux", "fast");
        runtime.unregisterVirtualModel("router", "auto");
        expect(runtime.getModels("faux").map((model) => model.id)).toEqual([
          "small",
          "large",
          "auto",
        ]);
        expect(runtime.getModels("router").map((model) => model.id)).toEqual(["second"]);
      }),
    ));

  it("rejects routes to virtual or unknown models", () =>
    runTest(
      Effect.gen(function* () {
        const { runtime, definition, virtual } = yield* awaited(createRuntime());
        const unknown = { ...virtual, provider: "faux", id: "missing" };

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
      }),
    ));

  it("routes direct streamSimple calls within the routed model's limits", () =>
    runTest(
      Effect.gen(function* () {
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
            { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
            { reasoning: "high", maxTokens: 20_000 },
          ),
        );

        expect(requests.map((request) => request.reason)).toEqual(["direct"]);
        expect(message).toMatchObject({ provider: "faux", model: "large", stopReason: "stop" });
        expect(maxTokens).toBe(5000);
      }),
    ));

  it("does not forward caller credentials to a routed model of another provider", () =>
    runTest(
      Effect.gen(function* () {
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
        const context = { messages: [{ role: "user" as const, content: "hi", timestamp: 1 }] };
        const options = { apiKey: "caller-key", headers: { "x-caller": "1" } };
        runtime.registerVirtualModel({ ...definition, provider: "faux", id: "auto" });

        yield* awaited(runtime.completeSimple(virtual, context, options));
        yield* awaited(runtime.completeSimple(runtime.getModel("faux", "auto")!, context, options));

        const [routed] = seen;
        if (routed === undefined) throw new Error("expected the routed request to be seen");
        expect(routed.apiKey).not.toBe("caller-key");
        expect(routed.headers?.["x-caller"]).toBeUndefined();
        expect(seen[1]).toMatchObject({ apiKey: "caller-key", headers: { "x-caller": "1" } });
      }),
    ));

  it("fails unrouted stream calls on virtual models", () =>
    runTest(
      Effect.gen(function* () {
        const { runtime, virtual } = yield* awaited(createRuntime());

        const message = yield* awaited(
          runtime.complete(virtual, {
            messages: [{ role: "user", content: "hi", timestamp: 1 }],
          }),
        );

        expect(message.stopReason).toBe("error");
        expect(message.errorMessage).toContain("must be routed before streaming");
      }),
    ));
});

describe("createAgentSession with virtual models", () => {
  let tempDir: string;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = yield* makeTempDir("msa-virtual-models-");
      }),
    ),
  );

  afterEach(() => runTest(removePath(tempDir)));

  function resume(runtime: ModelRuntime, model?: Model<string>) {
    return runTest(
      Effect.gen(function* () {
        const sessionManager = SessionManager.inMemory(tempDir);
        sessionManager.appendModelChange("router", "auto");
        sessionManager.appendMessage({ role: "user", content: "hi", timestamp: 1 });
        sessionManager.appendMessage(assistantFrom(runtime.getModel("faux", "large")!, "hello"));
        const resourceLoader = createTestResourceLoader();
        const options = {
          cwd: tempDir,
          agentDir: tempDir,
          modelRuntime: runtime,
          sessionManager,
          resourceLoader,
          ...(model === undefined ? {} : { model }),
        };
        const { session } = yield* awaited(createAgentSession(options));
        onTestFinished(() => session.dispose());
        return yield* awaited({ session, sessionManager });
      }),
    );
  }

  it("restores the virtual selection instead of the physical model that answered", () =>
    runTest(
      Effect.gen(function* () {
        const { runtime } = yield* awaited(createRuntime());

        const { session } = yield* awaited(resume(runtime));

        expect(session.model).toMatchObject({ provider: "router", id: "auto" });
        expect(session.routedModel?.model).toMatchObject({ provider: "faux", id: "large" });
      }),
    ));

  it("restores a virtual selection registered right before the session opens", () =>
    runTest(
      Effect.gen(function* () {
        const { runtime, definition } = yield* awaited(createRuntime());

        runtime.registerVirtualModel({ ...definition, provider: "late" });
        const sessionManager = SessionManager.inMemory(tempDir);
        sessionManager.appendModelChange("late", "auto");
        sessionManager.appendMessage({ role: "user", content: "hi", timestamp: 1 });
        sessionManager.appendMessage(assistantFrom(runtime.getModel("faux", "large")!, "hello"));

        const { session, modelFallbackMessage } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir: tempDir,
            modelRuntime: runtime,
            sessionManager,
            resourceLoader: createTestResourceLoader(),
          }),
        );
        onTestFinished(() => session.dispose());

        expect(modelFallbackMessage).toBeUndefined();
        expect(session.model).toMatchObject({ provider: "late", id: "auto" });
      }),
    ));

  it("falls back to the physical model when the virtual model is not registered", () =>
    runTest(
      Effect.gen(function* () {
        const { runtime } = yield* awaited(createRuntime());
        runtime.unregisterVirtualModel("router", "auto");

        const { session } = yield* awaited(resume(runtime));

        expect(session.model).toMatchObject({ provider: "faux", id: "large" });
        expect(session.routedModel).toBeUndefined();
      }),
    ));

  it("falls back to the last physical response when the transcript ends with a routing failure", () =>
    runTest(
      Effect.gen(function* () {
        const { runtime, virtual } = yield* awaited(createRuntime());
        const sessionManager = SessionManager.inMemory(tempDir);
        sessionManager.appendModelChange("router", "auto");
        sessionManager.appendMessage({ role: "user", content: "hi", timestamp: 1 });
        sessionManager.appendMessage(assistantFrom(runtime.getModel("faux", "large")!, "hello"));
        sessionManager.appendMessage({ role: "user", content: "again", timestamp: 2 });
        sessionManager.appendMessage({
          ...assistantFrom(virtual, ""),
          stopReason: "error",
          errorMessage: "router failed",
        });
        runtime.unregisterVirtualModel("router", "auto");

        const { session, modelFallbackMessage } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir: tempDir,
            modelRuntime: runtime,
            sessionManager,
            resourceLoader: createTestResourceLoader(),
          }),
        );
        onTestFinished(() => session.dispose());

        expect(session.model).toMatchObject({ provider: "faux", id: "large" });
        expect(modelFallbackMessage).toBeUndefined();
      }),
    ));

  it("resumes the selection made before tree navigation left its model_change on another branch", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const { runtime, faux, virtual } = yield* awaited(createRuntime());
        faux.setResponses(Array.from({ length: 6 }, () => fauxAssistantMessage("ok")));
        const large = runtime.getModel("faux", "large")!;
        const open = (sessionManager: SessionManager, model?: Model<string>) =>
          effectRunPromise(
            Effect.gen(function* () {
              const resourceLoader = createTestResourceLoader();
              const options = {
                cwd: tempDir,
                agentDir: tempDir,
                modelRuntime: runtime,
                sessionManager,
                resourceLoader,
                ...(model === undefined ? {} : { model }),
              };
              return yield* awaited((yield* awaited(createAgentSession(options))).session);
            }),
          );

        for (const [before, after] of [
          [virtual, large],
          [large, virtual],
        ] as const) {
          const sessionManager = SessionManager.inMemory(tempDir);
          const session = yield* awaited(open(sessionManager, before));
          yield* awaited(session.prompt("one"));
          const firstAnswer = sessionManager.getLeafId()!;
          yield* awaited(session.setModel(after));
          yield* awaited(session.prompt("two"));

          yield* awaited(session.navigateTree(firstAnswer));
          yield* awaited(session.prompt("three"));
          session.dispose();

          const resumed = yield* awaited(open(sessionManager));
          onTestFinished(() => resumed.dispose());
          expect(resumed.model).toMatchObject({ provider: after.provider, id: after.id });
        }
      }),
    ));

  it("does not record a physical selection on every prompt while requests are redirected", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const { runtime, faux } = yield* awaited(createRuntime());
        faux.setResponses([fauxAssistantMessage("ok"), fauxAssistantMessage("ok")]);
        const small = runtime.getModel("faux", "small")!;
        const large = runtime.getModel("faux", "large");
        if (!(large !== undefined)) throw new Error("faux/large is not registered");
        const sessionManager = SessionManager.inMemory(tempDir);
        const { session } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir: tempDir,
            modelRuntime: runtime,
            sessionManager,
            resourceLoader: createTestResourceLoader(),
            model: large,
          }),
        );
        onTestFinished(() => session.dispose());
        const prepareRequest = session.agent.prepareRequest!;
        session.agent.prepareRequest = (request, signal) =>
          effectRunPromise(
            Effect.gen(function* () {
              return {
                ...(yield* awaited(prepareRequest(request, signal))),
                model: small,
              };
            }),
          );

        const modelChanges = () =>
          sessionManager.getBranch().filter((entry) => entry.type === "model_change").length;
        const initial = modelChanges();

        yield* awaited(session.prompt("one"));
        yield* awaited(session.prompt("two"));

        expect(session.messages.filter((message) => message.role === "assistant")).toMatchObject([
          { model: "small" },
          { model: "small" },
        ]);
        expect(modelChanges()).toBe(initial);
      }),
    ));

  it("records an explicit model override on resume with the next prompt", () =>
    runTest(
      Effect.gen(function* () {
        const { runtime, faux } = yield* awaited(createRuntime());
        faux.setResponses([fauxAssistantMessage("ok")]);
        const lastModelChange = () =>
          sessionManager
            .getBranch()
            .filter((entry) => entry.type === "model_change")
            .at(-1);

        const { session, sessionManager } = yield* awaited(
          resume(runtime, runtime.getModel("faux", "small")),
        );

        expect(lastModelChange()).toMatchObject({ provider: "router", modelId: "auto" });

        yield* awaited(session.prompt("again"));
        expect(lastModelChange()).toMatchObject({ provider: "faux", modelId: "small" });
      }),
    ));
});
