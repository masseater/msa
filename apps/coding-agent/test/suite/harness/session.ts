import { Effect } from "effect";

import codingAgent from "../../../src/index.ts";
import type codingAgentTypes from "../../../src/index.types.ts";
import modelRuntimeTestUtils from "../../model-runtime-test-utils.ts";
import utilities from "../../utilities.ts";
import agentModule from "./agent.ts";
import auth from "./auth.ts";
import runtime from "./runtime.ts";
import state from "./state.ts";
import type typesModule from "./types.ts";

const { AgentSession } = codingAgent;

const { closeSession, createTempDir } = runtime;
const {
  createAuthStorage,
  createFauxProvider,
  createRegistry,
  modelsPathFor,
  registerFauxModels,
  writeModelsJson,
} = auth;
const { createSessionManager, createSettingsManager } = state;
const { createFauxAgent } = agentModule;
const { createTestExtensionsResult, createTestResourceLoader } = utilities;
const { getModelRuntime } = modelRuntimeTestUtils;

type Faux = ReturnType<typeof createFauxProvider>;

const createModelSetup = Effect.fn("createModelSetup")(function* (
  options: typesModule.HarnessOptions,
  tempDir: string,
  fauxProvider: Faux,
) {
  const model = fauxProvider.getModel();
  const withConfiguredAuth = options.withConfiguredAuth ?? true;
  const authStorage = yield* Effect.promise(() =>
    createAuthStorage({ provider: model.provider, withConfiguredAuth }),
  );
  const { modelsJson } = options;
  const modelsPath = modelsPathFor({ modelsJson, tempDir });
  if (modelsPath !== undefined && modelsPath !== "" && modelsJson !== undefined) {
    yield* Effect.promise(() => writeModelsJson({ modelsJson, modelsPath }));
  }
  const modelRegistry = yield* Effect.promise(() => createRegistry({ authStorage, modelsPath }));
  if (withConfiguredAuth) registerFauxModels({ fauxProvider, model, modelRegistry });
  return { authStorage, model, modelRegistry, withConfiguredAuth };
});

const resolveResourceLoader = Effect.fn("resolveResourceLoader")(function* (
  options: typesModule.HarnessOptions,
  tempDir: string,
) {
  const { extensionFactories, resourceLoader } = options;
  if (resourceLoader !== undefined) return resourceLoader;
  if (extensionFactories === undefined) return createTestResourceLoader();
  const extensionsResult = yield* Effect.promise(() =>
    createTestExtensionsResult(extensionFactories, tempDir),
  );
  return createTestResourceLoader({ extensionsResult });
});

const toolSelection = (options: typesModule.HarnessOptions) => ({
  ...(options.tools === undefined
    ? {}
    : { baseToolsOverride: Object.fromEntries(options.tools.map((tool) => [tool.name, tool])) }),
  ...(options.initialActiveToolNames === undefined
    ? {}
    : { initialActiveToolNames: options.initialActiveToolNames }),
  usesDefaultTools: options.initialActiveToolNames === undefined,
  ...(options.allowedToolNames === undefined ? {} : { allowedToolNames: options.allowedToolNames }),
  ...(options.excludedToolNames === undefined
    ? {}
    : { excludedToolNames: options.excludedToolNames }),
});

const harnessFor = (input: {
  authStorage: typesModule.Harness["authStorage"];
  fauxProvider: Faux;
  session: codingAgentTypes.AgentSession;
  sessionManager: typesModule.Harness["sessionManager"];
  settingsManager: typesModule.Harness["settingsManager"];
  tempDir: string;
}): typesModule.Harness => {
  const { fauxProvider, session, tempDir } = input;
  const events: codingAgentTypes.AgentSessionEvent[] = [];
  session.subscribe((event) => {
    events.push(event);
  });
  return {
    appendResponses: fauxProvider.appendResponses,
    authStorage: input.authStorage,
    cleanup: () => closeSession({ fauxProvider, session, tempDir }),
    events,
    eventsOfType<T extends codingAgentTypes.AgentSessionEvent["type"]>(type: T) {
      return events.filter(
        (event): event is Extract<codingAgentTypes.AgentSessionEvent, { type: T }> =>
          event.type === type,
      );
    },
    faux: fauxProvider,
    getModel: fauxProvider.getModel,
    getPendingResponseCount: fauxProvider.getPendingResponseCount,
    models: fauxProvider.models,
    session,
    sessionManager: input.sessionManager,
    setResponses: fauxProvider.setResponses,
    settingsManager: input.settingsManager,
    tempDir,
  };
};

const createHarness = (options: typesModule.HarnessOptions = {}): Promise<typesModule.Harness> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const tempDir = options.tempDir ?? (yield* Effect.promise(() => createTempDir()));
      const fauxProvider = createFauxProvider(options.models);
      const { authStorage, model, modelRegistry, withConfiguredAuth } = yield* createModelSetup(
        options,
        tempDir,
        fauxProvider,
      );
      const extensionRunnerRef: { current?: codingAgentTypes.ExtensionRunner } = {};
      const sessionManager = createSessionManager(options.sessionManager);
      const settingsManager = createSettingsManager(options.settings);
      const session = new AgentSession({
        agent: createFauxAgent({ extensionRunnerRef, fauxProvider, model, withConfiguredAuth }),
        agentDir: tempDir,
        cwd: tempDir,
        extensionRunnerRef,
        modelRuntime: getModelRuntime(modelRegistry),
        resourceLoader: yield* resolveResourceLoader(options, tempDir),
        sessionManager,
        settingsManager,
        telemetry: options.telemetry,
        ...toolSelection(options),
      });
      return harnessFor({
        authStorage,
        fauxProvider,
        session,
        sessionManager,
        settingsManager,
        tempDir,
      });
    }),
  );

const session = {
  createHarness,
};

export default session;
