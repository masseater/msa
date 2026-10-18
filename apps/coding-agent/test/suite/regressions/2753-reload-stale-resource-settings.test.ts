import * as NodeServices from "@effect/platform-node/NodeServices";
import { registerFauxProvider } from "@msa/ai/compat";
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
import { stringifyJsonPretty } from "../../test-json.ts";
import { join } from "../../test-path.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const cleanups: Array<() => void> = [];

const appliesUpdatedTopLevelPromptSettings = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const tempDir = yield* fs.makeTempDirectory({ prefix: `msa-2753-` });
  const agentDir = join(tempDir, "agent");
  const promptsDir = join(agentDir, "prompts");
  yield* fs.makeDirectory(promptsDir, { recursive: true });
  yield* fs.writeFileString(join(promptsDir, "test.md"), "Echo test prompt\n");

  const faux = registerFauxProvider({
    models: [{ id: "faux-1", reasoning: false }],
  });
  const authStorage = AuthStorage.inMemory();
  yield* Effect.promise(() =>
    authStorage.modify(faux.getModel().provider, () =>
      Promise.resolve({
        type: "api_key",
        key: "faux-key",
      }),
    ),
  );
  const modelRuntime = yield* Effect.promise(() =>
    ModelRuntime.create({
      credentials: authStorage,
      modelsPath: join(agentDir, "models.json"),
    }),
  );

  const createRuntime: CreateAgentSessionRuntimeFactory = ({
    cwd,
    sessionManager,
    sessionStartEvent,
  }) =>
    runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.promise(() =>
          createAgentSessionServices({
            cwd,
            agentDir,
            modelRuntime,
            resourceLoaderOptions: {
              extensionFactories: [
                (msa) => {
                  msa.registerProvider(faux.getModel().provider, {
                    baseUrl: faux.getModel().baseUrl,
                    apiKey: "faux-key",
                    api: faux.api,
                    models: faux.models.map((registeredModel) => ({
                      id: registeredModel.id,
                      name: registeredModel.name,
                      api: registeredModel.api,
                      reasoning: registeredModel.reasoning,
                      input: registeredModel.input,
                      cost: registeredModel.cost,
                      contextWindow: registeredModel.contextWindow,
                      maxTokens: registeredModel.maxTokens,
                    })),
                  });
                },
              ],
              noSkills: true,
              noThemes: true,
            },
          }),
        );
        return {
          ...(yield* Effect.promise(() =>
            createAgentSessionFromServices({
              services,
              sessionManager,
              ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
              model: faux.getModel(),
            }),
          )),
          services,
          diagnostics: services.diagnostics,
        };
      }),
    );
  const sessionRuntime = yield* Effect.promise(() =>
    createAgentSessionRuntime(createRuntime, {
      cwd: tempDir,
      agentDir,
      sessionManager: SessionManager.create(tempDir),
    }),
  );

  cleanups.push(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        sessionRuntime.session.dispose();
        faux.unregister();
        if (yield* fs.exists(tempDir)) {
          yield* fs.remove(tempDir, { recursive: true, force: true });
        }
      }),
    ),
  );

  expect(sessionRuntime.session.promptTemplates.map((prompt) => prompt.name)).toContain("test");

  yield* fs.writeFileString(
    join(agentDir, "settings.json"),
    `${stringifyJsonPretty({ prompts: ["-prompts/test.md"] })}\n`,
  );

  yield* Effect.promise(() => sessionRuntime.session.reload());

  expect(sessionRuntime.services.settingsManager.getGlobalSettings().prompts).toEqual([
    "-prompts/test.md",
  ]);
  expect(sessionRuntime.session.promptTemplates.map((prompt) => prompt.name)).not.toContain("test");
});

describe("issue #2753 reload stale resource settings", () => {
  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });
  it("applies updated top-level prompt settings on reload after startup", () =>
    Effect.runPromise(appliesUpdatedTopLevelPromptSettings));
});
