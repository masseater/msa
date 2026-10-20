import * as NodeServices from "@effect/platform-node/NodeServices";
import { registerFauxProvider } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
} from "../../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { ModelRuntime } from "../../../src/core/model-runtime.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";

const { joinPath, toJsonText } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const cleanups: Array<() => void> = [];

type Faux = ReturnType<typeof registerFauxProvider>;

const registerFauxModels =
  (faux: Faux) => (msa: { registerProvider: (name: string, config: object) => void }) => {
    msa.registerProvider(faux.getModel().provider, {
      api: faux.api,
      apiKey: "faux-key",
      baseUrl: faux.getModel().baseUrl,
      models: faux.models.map((registeredModel) => ({
        api: registeredModel.api,
        contextWindow: registeredModel.contextWindow,
        cost: registeredModel.cost,
        id: registeredModel.id,
        input: registeredModel.input,
        maxTokens: registeredModel.maxTokens,
        name: registeredModel.name,
        reasoning: registeredModel.reasoning,
      })),
    });
  };

const createFauxModelRuntime = (agentDir: string) =>
  Effect.gen(function* () {
    const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: false }] });
    const authStorage = AuthStorage.inMemory();
    yield* Effect.promise(() =>
      authStorage.modify(faux.getModel().provider, () =>
        Promise.resolve({ key: "faux-key", type: "api_key" }),
      ),
    );
    const modelRuntime = yield* Effect.promise(() =>
      ModelRuntime.create({
        credentials: authStorage,
        modelsPath: joinPath(agentDir, "models.json"),
      }),
    );
    return { faux, modelRuntime };
  });

const runtimeFactory =
  (agentDir: string, faux: Faux, modelRuntime: ModelRuntime): CreateAgentSessionRuntimeFactory =>
  ({ cwd, sessionManager, sessionStartEvent }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.promise(() =>
          createAgentSessionServices({
            agentDir,
            cwd,
            modelRuntime,
            resourceLoaderOptions: {
              extensionFactories: [registerFauxModels(faux)],
              noSkills: true,
              noThemes: true,
            },
          }),
        );
        const created = yield* Effect.promise(() =>
          createAgentSessionFromServices({
            services,
            sessionManager,
            ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
            model: faux.getModel(),
          }),
        );
        return { ...created, diagnostics: services.diagnostics, services };
      }),
    );

const startSessionRuntime = Effect.gen(function* () {
  const tempDir = yield* fs.makeTempDirectory({ prefix: `msa-2753-` });
  const agentDir = joinPath(tempDir, "agent");
  const promptsDir = joinPath(agentDir, "prompts");
  yield* fs.makeDirectory(promptsDir, { recursive: true });
  yield* fs.writeFileString(joinPath(promptsDir, "test.md"), "Echo test prompt\n");
  const { faux, modelRuntime } = yield* createFauxModelRuntime(agentDir);
  const sessionRuntime = yield* Effect.promise(() =>
    createAgentSessionRuntime(runtimeFactory(agentDir, faux, modelRuntime), {
      agentDir,
      cwd: tempDir,
      sessionManager: SessionManager.create(tempDir),
    }),
  );
  cleanups.push(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        sessionRuntime.session.dispose();
        faux.unregister();
        if (yield* fs.exists(tempDir)) {
          yield* fs.remove(tempDir, { force: true, recursive: true });
        }
      }),
    ),
  );
  return { agentDir, sessionRuntime };
});

const appliesUpdatedTopLevelPromptSettings = Effect.gen(function* () {
  const { agentDir, sessionRuntime } = yield* startSessionRuntime;
  expect(sessionRuntime.session.promptTemplates.map((prompt) => prompt.name)).toContain("test");

  yield* fs.writeFileString(
    joinPath(agentDir, "settings.json"),
    `${yield* toJsonText({ prompts: ["-prompts/test.md"] })}\n`,
  );

  yield* Effect.promise(() => sessionRuntime.session.reload());

  expect(sessionRuntime.services.settingsManager.getGlobalSettings().prompts).toEqual([
    "-prompts/test.md",
  ]);
  expect(sessionRuntime.session.promptTemplates.map((prompt) => prompt.name)).not.toContain("test");
});

const appliesUpdatedTopLevelPromptSettingsOn = () =>
  Effect.runPromise(appliesUpdatedTopLevelPromptSettings);

const afterEachHook = () => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
};

describe("issue #2753 reload stale resource settings", () => {
  afterEach(afterEachHook);
  it(
    "applies updated top-level prompt settings on reload after startup",
    appliesUpdatedTopLevelPromptSettingsOn,
  );
});
