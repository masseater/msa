import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";

import type agentSessionRuntimeTypes from "../src/core/agent-session-runtime.types.ts";
import AuthStorage from "../src/core/auth-storage.ts";
import type modelRuntimeTypes from "../src/core/model-runtime.types.ts";
import codingAgent from "../src/index.ts";
import type srcTypes from "../src/index.types.ts";
import type runtimeKitTypes from "./runtime-kit.types.ts";

const { createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices } =
  codingAgent;

const { ModelRuntime, SessionManager } = codingAgent;
const { fauxAssistantMessage, registerFauxProvider } = compat;

const { awaited, joinPath, makeDirectory, makeTempDir, removeDir, runTest } = testing;

const disposers: Effect.Effect<void>[] = [];

const track = (dispose: Effect.Effect<void>): void => {
  disposers.push(dispose);
};

const disposeRuntimes: Effect.Effect<void> = Effect.suspend(() =>
  Effect.forEach(disposers.splice(0).reverse(), (dispose) => dispose, { discard: true }),
);

const providerConfig = (faux: runtimeKitTypes.Faux) => ({
  api: faux.api,
  apiKey: "faux-key",
  baseUrl: faux.getModel().baseUrl,
  models: faux.models.map((model) => ({
    api: model.api,
    baseUrl: model.baseUrl,
    contextWindow: model.contextWindow,
    cost: model.cost,
    id: model.id,
    input: model.input,
    maxTokens: model.maxTokens,
    name: model.name,
    reasoning: model.reasoning,
  })),
});

const extensionFactoriesFor = (
  faux: runtimeKitTypes.Faux,
  options: runtimeKitTypes.FauxRuntimeOptions,
): srcTypes.ExtensionFactory[] => {
  const extensionFactory = options.extensionFactory ?? (() => {});
  if (options.providerViaExtension === false) {
    return [extensionFactory];
  }
  return [
    (msa: srcTypes.ExtensionAPI) => {
      msa.registerProvider(faux.getModel().provider, providerConfig(faux));
      return extensionFactory(msa);
    },
  ];
};

const createModelRuntime = Effect.fn("createModelRuntime")(function* (
  faux: runtimeKitTypes.Faux,
  tempDir: string,
) {
  const authStorage = AuthStorage.inMemory();
  yield* awaited(
    authStorage.modify(faux.getModel().provider, () =>
      Promise.resolve({ key: "faux-key", type: "api_key" as const }),
    ),
  );
  return yield* awaited(
    ModelRuntime.create({ credentials: authStorage, modelsPath: joinPath(tempDir, "models.json") }),
  );
});

const runtimeFactory = (input: {
  faux: runtimeKitTypes.Faux;
  modelRuntime: modelRuntimeTypes.ModelRuntime;
  options: runtimeKitTypes.FauxRuntimeOptions;
  tempDir: string;
}): agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory => {
  const model = input.options.bootstrapModel === false ? undefined : input.faux.getModel();
  const extensionFactories = extensionFactoriesFor(input.faux, input.options);
  return ({ cwd, sessionManager, sessionStartEvent }) =>
    runTest(
      Effect.gen(function* () {
        const services = yield* awaited(
          createAgentSessionServices({
            agentDir: input.options.agentDir ?? input.tempDir,
            cwd,
            modelRuntime: input.modelRuntime,
            resourceLoaderOptions: {
              extensionFactories,
              noPromptTemplates: true,
              noSkills: true,
              noThemes: true,
            },
          }),
        );
        const created = yield* awaited(
          createAgentSessionFromServices({
            services,
            sessionManager,
            ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
            ...(model === undefined ? {} : { model }),
          }),
        );
        return { ...created, diagnostics: services.diagnostics, services };
      }),
    );
};

const bindRuntimeCommands = (
  runtime: agentSessionRuntimeTypes.AgentSessionRuntime,
): Promise<void> => {
  const { session } = runtime;
  return session.extensions.binding.bindExtensions({
    commandContextActions: {
      fork: (entryId, options) =>
        runtime.fork(entryId, options).then((result) => ({ cancelled: result.cancelled })),
      navigateTree: (targetId, options) =>
        session.context.tree
          .navigateTree(targetId, {
            ...(options?.summarize === undefined ? {} : { summarize: options.summarize }),
            ...(options?.customInstructions === undefined
              ? {}
              : { customInstructions: options.customInstructions }),
            ...(options?.replaceInstructions === undefined
              ? {}
              : { replaceInstructions: options.replaceInstructions }),
            ...(options?.label === undefined ? {} : { label: options.label }),
          })
          .then((result) => ({ cancelled: result.cancelled })),
      newSession: (options) => Promise.resolve(runtime.newSession(options)),
      reload: () => session.extensions.runtime.reload(),
      switchSession: (sessionPath, options) =>
        Promise.resolve(runtime.switchSession(sessionPath, options)),
      waitForIdle: () => session.agent.waitForIdle(),
    },
  });
};

const bindRuntime = Effect.fn("bindRuntime")(function* (
  runtime: agentSessionRuntimeTypes.AgentSessionRuntime,
  commandActions: boolean,
) {
  if (!commandActions) {
    yield* awaited(runtime.session.extensions.binding.bindExtensions({}));
    return;
  }
  runtime.setRebindSession(() => bindRuntimeCommands(runtime));
  yield* awaited(bindRuntimeCommands(runtime));
});

const registerFaux = (options: runtimeKitTypes.FauxRuntimeOptions): runtimeKitTypes.Faux => {
  const faux = registerFauxProvider(
    options.models === undefined ? undefined : { models: options.models },
  );
  faux.setResponses(
    (options.responses ?? ["one", "two", "three"]).map((text) => fauxAssistantMessage(text)),
  );
  return faux;
};

const createFauxRuntime = Effect.fn("createFauxRuntime")(function* (
  options: runtimeKitTypes.FauxRuntimeOptions = {},
) {
  const tempDir = options.cwd ?? (yield* makeTempDir("msa-runtime-"));
  yield* makeDirectory(tempDir);
  const faux = options.faux ?? registerFaux(options);
  const modelRuntime = yield* createModelRuntime(faux, tempDir);
  if (options.providerViaExtension === false) {
    modelRuntime.registerProvider(faux.getModel().provider, providerConfig(faux));
  }
  const runtime = yield* awaited(
    createAgentSessionRuntime(runtimeFactory({ faux, modelRuntime, options, tempDir }), {
      agentDir: options.agentDir ?? tempDir,
      cwd: tempDir,
      sessionManager:
        options.inMemory === true
          ? SessionManager.inMemory(tempDir)
          : SessionManager.create(tempDir),
    }),
  );
  yield* bindRuntime(runtime, options.commandActions === true);
  track(
    Effect.gen(function* () {
      yield* awaited(runtime.dispose());
      if (options.faux === undefined) {
        faux.unregister();
      }
      yield* removeDir(tempDir);
    }),
  );
  return { faux, runtime, tempDir };
});

const runtimeKit = {
  bindRuntimeCommands,
  createFauxRuntime,
  disposeRuntimes,
  track,
};

export default runtimeKit;
