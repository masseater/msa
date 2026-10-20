import { fauxAssistantMessage, registerFauxProvider } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";

const { makeDirectory, tempRoot } = testing;

const tempDir = `${tempRoot()}/msa-orchestrator-sdk-${process.pid}`;

function registerModel(
  modelRuntime: ModelRuntime,
  model: NonNullable<ReturnType<ReturnType<typeof registerFauxProvider>["getModel"]>>,
): void {
  modelRuntime.registerProvider(model.provider, {
    api: model.api,
    baseUrl: model.baseUrl,
    models: [
      {
        api: model.api,
        baseUrl: model.baseUrl,
        contextWindow: model.contextWindow,
        cost: model.cost,
        id: model.id,
        input: model.input,
        maxTokens: model.maxTokens,
        name: model.name,
        reasoning: model.reasoning,
      },
    ],
  });
}

function createHarness(options?: { isWorker?: boolean }) {
  return Effect.gen(function* () {
    yield* makeDirectory(tempDir);
    const sessionDir = `${tempDir}/sessions`;
    const faux = registerFauxProvider();
    faux.setResponses(
      Array.from({ length: 6 }, (_, index) => fauxAssistantMessage(`reply ${index}`)),
    );
    const model = faux.getModel();
    const authStorage = AuthStorage.inMemory();
    yield* Effect.promise(() =>
      authStorage.modify(model.provider, () =>
        Promise.resolve({ key: "faux-key", type: "api_key" }),
      ),
    );
    const modelRuntime = yield* Effect.promise(() =>
      ModelRuntime.create({ credentials: authStorage, modelsPath: `${tempDir}/models.json` }),
    );
    registerModel(modelRuntime, model);
    const sessionManager = SessionManager.create(tempDir, sessionDir, { id: "sdk" });
    const { session } = yield* Effect.promise(() =>
      createAgentSession({
        agentDir: tempDir,
        cwd: tempDir,
        model,
        modelRuntime,
        sessionManager,
        ...(options?.isWorker === undefined ? {} : { isWorker: options.isWorker }),
      }),
    );
    sessionManager.appendMessage({ content: "start", role: "user", timestamp: 1 });
    return { faux, session, sessionDir, sessionManager };
  });
}

const orchestratorSdkSupport = {
  createHarness,
  tempDir,
};

export default orchestratorSdkSupport;
