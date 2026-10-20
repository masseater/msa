import ai from "@msa/ai";
import {
  type AgentSession,
  type InlineExtension,
  ModelRuntime,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionServices,
  readStoredCredential,
} from "@msa/coding-agent";
import { Effect } from "effect";
import type { JsonValue } from "vitest-evals/harness";

import { files, pathOperations } from "./platform.ts";
import type { HostSelection, Options, RunPaths, RunState } from "./run-types.ts";
import { seedWorkspace } from "./workspace.ts";

const { InMemoryCredentialStore } = ai;

export const throwIfAborted = (signal: AbortSignal | undefined): Effect.Effect<void> =>
  Effect.sync(() => signal?.throwIfAborted());

const authenticate = (
  modelRuntime: ModelRuntime,
  selection: HostSelection["selection"],
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

export const prepareModel = <TOutput extends JsonValue>({
  options,
  paths,
  host,
}: {
  options: Options<TOutput>;
  paths: RunPaths;
  host: HostSelection;
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

export type PreparedModel = Effect.Success<ReturnType<typeof prepareModel>>;

export const openSession = <TOutput extends JsonValue>({
  state,
  options,
  paths,
  prepared,
  extensionFactories,
  signal,
}: {
  state: RunState<TOutput>;
  options: Options<TOutput>;
  paths: RunPaths;
  prepared: PreparedModel;
  extensionFactories: InlineExtension[];
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

export const assertOnlyInlineExtensions = ({
  session,
  extensionFactories,
}: {
  session: AgentSession;
  extensionFactories: readonly InlineExtension[];
}): Effect.Effect<void> =>
  Effect.sync(() => {
    const expected = new Set(extensionFactories.map(({ name }) => `<inline:${name}>`));
    const unexpected = session.extensionRunner
      .getExtensionPaths()
      .filter((path) => !expected.has(path));
    if (unexpected.length > 0) {
      throw new Error(`Isolated eval loaded unexpected extensions: ${unexpected.join(", ")}`);
    }
  });
