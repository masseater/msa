import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import AuthStorage from "../src/core/auth-storage.ts";
import InMemoryCodingAgentModelsStore from "../src/core/in-memory-coding-agent-models-store.ts";
import modelPolicy from "../src/core/model-policy.ts";
import type modelPolicyTypes from "../src/core/model-policy.types.ts";
import ModelRuntime from "../src/core/model-runtime.ts";

const { EMPTY_MODEL_POLICY, mergeModelPolicies } = modelPolicy;
const { awaited, joinPath, makeTempDir, removeDirs, runTest, toJsonText, writeTextFile } = testing;

function model(provider: string, id: string): aiTypes.Model<aiTypes.Api> {
  return { id, name: id, provider } as unknown as aiTypes.Model<aiTypes.Api>;
}

function policy(allow: string[], deny: string[]): modelPolicyTypes.ModelPolicy {
  return { allow, deny };
}

const tempDirs: string[] = [];

const cleanupRuntimeDirs = () => runTest(removeDirs(tempDirs.splice(0)));

function createRuntime(settings: Partial<Record<string, unknown>> = {}) {
  return runTest(
    Effect.gen(function* () {
      const dir = yield* makeTempDir("msa-policy-");
      tempDirs.push(dir);
      const modelsPath = joinPath(dir, "models.json");
      yield* writeTextFile(
        modelsPath,
        yield* toJsonText({
          providers: {
            local: {
              api: "openai-completions",
              apiKey: "local",
              baseUrl: "http://127.0.0.1:9/v1",
              models: [{ id: "alpha-1" }, { id: "alpha-2" }, { id: "beta-1" }],
            },
          },
        }),
      );
      const modelRuntime = yield* awaited(
        ModelRuntime.create({
          allowModelNetwork: false,
          credentials: AuthStorage.inMemory(),
          modelsPath,
          modelsStore: new InMemoryCodingAgentModelsStore(),
        }),
      );
      modelRuntime.setModelPolicy(
        mergeModelPolicies(EMPTY_MODEL_POLICY, {
          allow: [],
          deny: Array.isArray(settings["deny"]) ? (settings["deny"] as string[]) : [],
        }),
      );
      return { dir, modelRuntime };
    }),
  );
}

const modelPolicySupport = {
  cleanupRuntimeDirs,
  createRuntime,
  model,
  policy,
};

export default modelPolicySupport;
