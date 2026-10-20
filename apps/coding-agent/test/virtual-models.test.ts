import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type modelRuntimeTypes from "../src/core/model-runtime.types.ts";
import SessionManager from "../src/core/session-manager.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import virtualModels from "../src/core/virtual-models.ts";
import virtualModelsSupport from "./virtual-models-support.ts";
const { getBranchSelection } = virtualModels;

const { assistantFrom, createRuntime } = virtualModelsSupport;

const { awaited, runTest } = testing;

function select(
  build: (sessionManager: sessionManagerTypes.SessionManager) => void,
  runtime: modelRuntimeTypes.ModelRuntime,
) {
  const sessionManager = SessionManager.inMemory();
  build(sessionManager);
  const lookups: string[] = [];
  const selection = getBranchSelection(sessionManager.getBranch(), (provider, modelId) => {
    lookups.push(`${provider}/${modelId}`);
    return runtime.getModel(provider, modelId);
  });
  return { lookups, selection };
}

const usesTheLastModelChangeWithoutResponses = () =>
  runTest(
    Effect.gen(function* () {
      const { runtime, virtual } = yield* awaited(createRuntime());
      const small = runtime.getModel("faux", "small")!;
      const { selection, lookups } = select((sessionManager) => {
        sessionManager.appendModelChange(virtual.provider, virtual.id);
        sessionManager.appendMessage(assistantFrom(small, "ok"));
        sessionManager.appendModelChange(small.provider, small.id);
      }, runtime);
      expect(selection).toEqual({ modelId: "small", provider: "faux" });
      expect(lookups).toEqual([]);
    }),
  );

const usesTheLatestPhysicalResponseWithoutA = () =>
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
      expect(selection).toEqual({ modelId: "large", provider: "faux" });
      expect(lookups).toEqual([]);
    }),
  );

describe("getBranchSelection", () => {
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
        expect(physical.selection).toEqual({ modelId: "large", provider: "faux" });
        expect(physical.lookups).toEqual(["faux/small"]);

        const routed = select((sessionManager) => {
          sessionManager.appendModelChange(small.provider, small.id);
          sessionManager.appendMessage(assistantFrom(small, "ok"));
          sessionManager.appendModelChange(virtual.provider, virtual.id);
          for (let i = 0; i < 100; i++) sessionManager.appendMessage(assistantFrom(large, "ok"));
        }, runtime);
        expect(routed.selection).toEqual({ modelId: "auto", provider: "router" });
        expect(routed.lookups).toEqual(["router/auto"]);
      }),
    ));

  it(
    "uses the last model_change without responses after it",
    usesTheLastModelChangeWithoutResponses,
  );

  it(
    "uses the latest physical response without a model_change",
    usesTheLatestPhysicalResponseWithoutA,
  );
});
