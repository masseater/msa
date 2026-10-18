import { InMemoryCredentialStore } from "@msa/ai";
import {
  type AgentSession,
  createAgentSessionFromServices,
  createAgentSessionServices,
  type InlineExtension,
  ModelRuntime,
  readStoredCredential,
  SessionManager,
} from "@msa/coding-agent";
import { Effect } from "effect";
import type { JsonValue } from "vitest-evals/harness";

import { files, pathOperations, readEnv, unsetEnv } from "./platform.ts";
import type { HostSelection, Options, RunPaths, RunState } from "./run-types.ts";
import { seedWorkspace } from "./workspace.ts";

const CREDENTIAL_SOURCE = /^[A-Z][A-Z0-9_]*$/u;

export const throwIfAborted = (signal: AbortSignal | undefined): Effect.Effect<void> =>
  Effect.sync(() => signal?.throwIfAborted());

const hideCredentialEnvironment = (auth: {
  source?: string | undefined;
}): { name: string; value: string } | undefined => {
  const name = auth.source;
  if (name === undefined || !CREDENTIAL_SOURCE.test(name)) return undefined;
  const value = readEnv(name);
  if (value === undefined || value === "") return undefined;
  unsetEnv(name);
  return { name, value };
};

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
    return { model, auth };
  });

export const prepareModel = <TOutput extends JsonValue>({
  state,
  options,
  paths,
  host,
}: {
  state: RunState<TOutput>;
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
    const modelRuntime = yield* Effect.promise(() => ModelRuntime.create({ credentials }));
    yield* Effect.all([files.makeDirectory(paths.workspace), files.makeDirectory(paths.agentDir)]);
    yield* seedWorkspace(paths.workspace, options.workspaceFiles);
    const { model, auth } = yield* authenticate(modelRuntime, selection, storedCredential);
    if (sandboxIdentity !== undefined) {
      yield* files.remove(authPath);
      state.hiddenCredential = hideCredentialEnvironment(auth);
    }
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
        services,
        sessionManager,
        model: prepared.model,
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
