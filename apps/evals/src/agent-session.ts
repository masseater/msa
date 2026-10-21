import ai from "@msa/ai";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";
import type { JsonValue } from "vitest-evals/harness";

import platform from "./platform.ts";
import type runTypesTypes from "./run-types.ts";
import workspaceModule from "./workspace.ts";

const {
  ModelRuntime,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionServices,
  readStoredCredential,
} = codingAgent;
const { files, pathOperations } = platform;
const { seedWorkspace } = workspaceModule;

const { InMemoryCredentialStore } = ai;

const throwIfAborted = (signal: AbortSignal | undefined): Effect.Effect<void> =>
  Effect.sync(() => signal?.throwIfAborted());

const authenticate = (
  modelRuntime: codingAgentTypes.ModelRuntime,
  selection: runTypesTypes.HostSelection["selection"],
  storedCredential: ReturnType<typeof readStoredCredential>,
) =>
  Effect.gen(function* () {
    const model = modelRuntime.getModel(selection.provider, selection.id);
    if (model === undefined) {
      return yield* Effect.die(
        new Error(`Eval model not found: ${selection.provider}/${selection.id}`),
      );
    }
    const auth = yield* Effect.promise(() => modelRuntime.getAuth(model));
    if (auth === undefined) {
      return yield* Effect.die(
        new Error(
          `Eval model has no configured authentication: ${selection.provider}/${selection.id}`,
        ),
      );
    }
    const apiKey = auth.auth.apiKey;
    if (storedCredential === undefined && apiKey !== undefined && apiKey !== "") {
      yield* Effect.promise(() => modelRuntime.setRuntimeApiKey(selection.provider, apiKey));
    }
    return model;
  });

const prepareModel = <TOutput extends JsonValue>({
  options,
  paths,
  host,
}: {
  options: runTypesTypes.Options<TOutput>;
  paths: runTypesTypes.RunPaths;
  host: runTypesTypes.HostSelection;
}) =>
  Effect.gen(function* () {
    const { selection, authPath, sandboxIdentity } = host;
    const credentials = new InMemoryCredentialStore();
    const storedCredential = readStoredCredential(selection.provider, authPath);
    if (storedCredential !== undefined) {
      yield* Effect.promise(() =>
        credentials.modify(selection.provider, () => Promise.resolve(storedCredential)),
      );
    }
    yield* Effect.all([files.makeDirectory(paths.workspace), files.makeDirectory(paths.agentDir)]);
    const modelRuntime = yield* Effect.promise(() =>
      ModelRuntime.create({
        credentials,
        modelsPath: pathOperations.join(paths.agentDir, "models.json"),
        modelsStorePath: pathOperations.join(paths.agentDir, "models-store.json"),
      }),
    );
    yield* seedWorkspace(paths.workspace, options.workspaceFiles);
    const model = yield* authenticate(modelRuntime, selection, storedCredential);
    if (sandboxIdentity !== undefined) yield* files.remove(authPath);
    return { model, modelRuntime };
  });

type PreparedModel = Effect.Success<ReturnType<typeof prepareModel>>;

const openSession = <TOutput extends JsonValue>({
  state,
  options,
  paths,
  prepared,
  extensionFactories,
  signal,
}: {
  state: runTypesTypes.RunState<TOutput>;
  options: runTypesTypes.Options<TOutput>;
  paths: runTypesTypes.RunPaths;
  prepared: PreparedModel;
  extensionFactories: codingAgentTypes.InlineExtension[];
  signal: AbortSignal | undefined;
}) =>
  Effect.gen(function* () {
    const services = yield* Effect.promise(() =>
      createAgentSessionServices({
        agentDir: paths.agentDir,
        cwd: paths.workspace,
        modelRuntime: prepared.modelRuntime,
        resourceLoaderOptions: { extensionFactories },
      }),
    );
    yield* throwIfAborted(signal);
    const sessionManager = SessionManager.create(
      paths.workspace,
      pathOperations.join(paths.root, "sessions"),
    );
    state.sessionManager = sessionManager;
    const { session } = yield* Effect.promise(() =>
      createAgentSessionFromServices({
        model: prepared.model,
        services,
        sessionManager,
        thinkingLevel: "off",
        ...(options.tools === undefined ? {} : { tools: options.tools }),
        ...(options.noTools === undefined ? {} : { noTools: options.noTools }),
        ...(options.customTools === undefined ? {} : { customTools: options.customTools }),
      }),
    );
    state.session = session;
    return { session, sessionManager };
  });

const assertOnlyInlineExtensions = ({
  session,
  extensionFactories,
}: {
  session: codingAgentTypes.AgentSession;
  extensionFactories: readonly codingAgentTypes.InlineExtension[];
}): Effect.Effect<void> =>
  Effect.sync(() => {
    const expected = new Set(extensionFactories.map(({ name }) => `<inline:${name}>`));
    const unexpected = session.extensions.binding.extensionRunner
      .getExtensionPaths()
      .filter((path) => !expected.has(path));
    if (unexpected.length > 0) {
      throw new Error(`Isolated eval loaded unexpected extensions: ${unexpected.join(", ")}`);
    }
  });

const agentSession = {
  assertOnlyInlineExtensions,
  openSession,
  prepareModel,
  throwIfAborted,
};

export default agentSession;
