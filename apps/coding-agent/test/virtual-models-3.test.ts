import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vite-plus/test";

import { ModelRuntime } from "../src/core/model-runtime.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import utilities from "./utilities.ts";
import virtualModelsSupport from "./virtual-models-support.ts";

const { fauxAssistantMessage } = ai;

const { assistantFrom, createRuntime } = virtualModelsSupport;

const { createTestResourceLoader } = utilities;

const { awaited, makeTempDir, removePath, runTest } = testing;

let tempDir: string;

function resume(runtime: ModelRuntime, model?: aiTypes.Model<string>) {
  return runTest(
    Effect.gen(function* () {
      const sessionManager = SessionManager.inMemory(tempDir);
      sessionManager.appendModelChange("router", "auto");
      sessionManager.appendMessage({ content: "hi", role: "user", timestamp: 1 });
      sessionManager.appendMessage(assistantFrom(runtime.getModel("faux", "large")!, "hello"));
      const resourceLoader = createTestResourceLoader();
      const options = {
        agentDir: tempDir,
        cwd: tempDir,
        modelRuntime: runtime,
        resourceLoader,
        sessionManager,
        ...(model === undefined ? {} : { model }),
      };
      const { session } = yield* awaited(createAgentSession(options));
      onTestFinished(() => session.dispose());
      return yield* awaited({ session, sessionManager });
    }),
  );
}

const restoresTheVirtualSelectionInsteadOfThe = () =>
  runTest(
    Effect.gen(function* () {
      const { runtime } = yield* awaited(createRuntime());

      const { session } = yield* awaited(resume(runtime));

      expect(session.model).toMatchObject({ id: "auto", provider: "router" });
      expect(session.routedModel?.model).toMatchObject({ id: "large", provider: "faux" });
    }),
  );

const restoresAVirtualSelectionRegisteredRightBefore = () =>
  runTest(
    Effect.gen(function* () {
      const { runtime, definition } = yield* awaited(createRuntime());

      runtime.registerVirtualModel({ ...definition, provider: "late" });
      const sessionManager = SessionManager.inMemory(tempDir);
      sessionManager.appendModelChange("late", "auto");
      sessionManager.appendMessage({ content: "hi", role: "user", timestamp: 1 });
      sessionManager.appendMessage(assistantFrom(runtime.getModel("faux", "large")!, "hello"));

      const { session, modelFallbackMessage } = yield* awaited(
        createAgentSession({
          agentDir: tempDir,
          cwd: tempDir,
          modelRuntime: runtime,
          resourceLoader: createTestResourceLoader(),
          sessionManager,
        }),
      );
      onTestFinished(() => session.dispose());

      expect(modelFallbackMessage).toBeUndefined();
      expect(session.model).toMatchObject({ id: "auto", provider: "late" });
    }),
  );

const fallsBackToThePhysicalModelWhen = () =>
  runTest(
    Effect.gen(function* () {
      const { runtime } = yield* awaited(createRuntime());
      runtime.unregisterVirtualModel("router", "auto");

      const { session } = yield* awaited(resume(runtime));

      expect(session.model).toMatchObject({ id: "large", provider: "faux" });
      expect(session.routedModel).toBeUndefined();
    }),
  );

const fallsBackToTheLastPhysicalResponse = () =>
  runTest(
    Effect.gen(function* () {
      const { runtime, virtual } = yield* awaited(createRuntime());
      const sessionManager = SessionManager.inMemory(tempDir);
      sessionManager.appendModelChange("router", "auto");
      sessionManager.appendMessage({ content: "hi", role: "user", timestamp: 1 });
      sessionManager.appendMessage(assistantFrom(runtime.getModel("faux", "large")!, "hello"));
      sessionManager.appendMessage({ content: "again", role: "user", timestamp: 2 });
      sessionManager.appendMessage({
        ...assistantFrom(virtual, ""),
        errorMessage: "router failed",
        stopReason: "error",
      });
      runtime.unregisterVirtualModel("router", "auto");

      const { session, modelFallbackMessage } = yield* awaited(
        createAgentSession({
          agentDir: tempDir,
          cwd: tempDir,
          modelRuntime: runtime,
          resourceLoader: createTestResourceLoader(),
          sessionManager,
        }),
      );
      onTestFinished(() => session.dispose());

      expect(session.model).toMatchObject({ id: "large", provider: "faux" });
      expect(modelFallbackMessage).toBeUndefined();
    }),
  );

const resumesTheSelectionMadeBeforeTreeNavigation = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const { runtime, faux, virtual } = yield* awaited(createRuntime());
      faux.setResponses(Array.from({ length: 6 }, () => fauxAssistantMessage("ok")));
      const large = runtime.getModel("faux", "large")!;
      const open = (sessionManager: SessionManager, model?: aiTypes.Model<string>) =>
        effectRunPromise(
          Effect.gen(function* () {
            const resourceLoader = createTestResourceLoader();
            const options = {
              agentDir: tempDir,
              cwd: tempDir,
              modelRuntime: runtime,
              resourceLoader,
              sessionManager,
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
        expect(resumed.model).toMatchObject({ id: after.id, provider: after.provider });
      }
    }),
  );

const doesNotRecordAPhysicalSelectionOn = () =>
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
          agentDir: tempDir,
          cwd: tempDir,
          model: large,
          modelRuntime: runtime,
          resourceLoader: createTestResourceLoader(),
          sessionManager,
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
  );

const recordsAnExplicitModelOverrideOnResume = () =>
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

      expect(lastModelChange()).toMatchObject({ modelId: "auto", provider: "router" });

      yield* awaited(session.prompt("again"));
      expect(lastModelChange()).toMatchObject({ modelId: "small", provider: "faux" });
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("msa-virtual-models-");
    }),
  );

describe("createAgentSession with virtual models", () => {
  beforeEach(beforeEachHook);

  afterEach(() => runTest(removePath(tempDir)));

  it(
    "restores the virtual selection instead of the physical model that answered",
    restoresTheVirtualSelectionInsteadOfThe,
  );

  it(
    "restores a virtual selection registered right before the session opens",
    restoresAVirtualSelectionRegisteredRightBefore,
  );

  it(
    "falls back to the physical model when the virtual model is not registered",
    fallsBackToThePhysicalModelWhen,
  );

  it(
    "falls back to the last physical response when the transcript ends with a routing failure",
    fallsBackToTheLastPhysicalResponse,
  );

  it(
    "resumes the selection made before tree navigation left its model_change on another branch",
    resumesTheSelectionMadeBeforeTreeNavigation,
  );

  it(
    "does not record a physical selection on every prompt while requests are redirected",
    doesNotRecordAPhysicalSelectionOn,
  );

  it(
    "records an explicit model override on resume with the next prompt",
    recordsAnExplicitModelOverrideOnResume,
  );
});
