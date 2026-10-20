import compat from "@msa/ai/compat";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import type sdkTypes from "../src/core/sdk.types.ts";
import SessionManager from "../src/core/session-manager.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import src from "../src/index.ts";
const { DefaultResourceLoader, ModelRuntime, createAgentSession } = src;

const { getModel } = compat;

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  pathExists,
  randomSuffixSync,
  removePath,
  runTest,
  tempRoot,
} = testing;

function nativeAnthropicProvider(baseUrl: string): aiTypes.Provider {
  const model = { ...getModel("anthropic-api", "claude-sonnet-4-5")!, baseUrl };
  return {
    auth: {
      apiKey: {
        name: "Test API key",
        resolve: () => runTest(awaited({ auth: { apiKey: "test-key" }, source: "test" })),
      },
    },
    baseUrl,
    getModels: () => [model],
    id: "anthropic-api",
    name: "Native Anthropic",
    stream: () => {
      throw new Error("unused");
    },
    streamSimple: () => {
      throw new Error("unused");
    },
  };
}

let tempDir: string;

let agentDir: string;

function createSession(extensionFactories: sdkTypes.ExtensionFactory[]) {
  return runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const settingsManager = SettingsManager.create(tempDir, agentDir);
      const sessionManager = SessionManager.inMemory();
      const authStorage = AuthStorage.create(joinPath(agentDir, "auth.json"));
      yield* awaited(
        authStorage.modify("anthropic-api", () =>
          effectRunPromise(awaited({ key: "test-key", type: "api_key" as const })),
        ),
      );
      const modelRuntime = yield* awaited(
        ModelRuntime.create({
          credentials: authStorage,
          modelsPath: joinPath(agentDir, "models.json"),
        }),
      );
      const resourceLoader = new DefaultResourceLoader({
        agentDir,
        cwd: tempDir,
        extensionFactories,
        settingsManager,
      });
      yield* awaited(resourceLoader.reload());

      const { session } = yield* awaited(
        createAgentSession({
          agentDir,
          cwd: tempDir,
          model: getModel("anthropic-api", "claude-sonnet-4-5")!,
          modelRuntime,
          resourceLoader,
          sessionManager,
          settingsManager,
        }),
      );

      return yield* awaited(session);
    }),
  );
}

function capturePromptBaseUrl(
  session: Awaited<ReturnType<typeof createSession>>,
): Promise<string | undefined> {
  return runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      let baseUrl: string | undefined;
      session.agent.streamFunction = (model) =>
        effectRunPromise(
          Effect.sync(() => {
            baseUrl = model.baseUrl;
            throw new Error("stop");
          }),
        );
      yield* awaited(session.run.prompting.prompt("hello"));
      return yield* awaited(baseUrl);
    }),
  );
}

const appliesTopLevelRegisterproviderOverridesToThe = () =>
  runTest(
    Effect.gen(function* () {
      const session = yield* awaited(
        createSession([
          (msa) => {
            msa.registerProvider("anthropic-api", { baseUrl: "http://localhost:8080/top-level" });
          },
        ]),
      );

      expect(session.model?.baseUrl).toBe("http://localhost:8080/top-level");
      expect(yield* awaited(capturePromptBaseUrl(session))).toBe("http://localhost:8080/top-level");

      session.dispose();
    }),
  );

const appliesSessionStartRegisterproviderOverridesToThe = () =>
  runTest(
    Effect.gen(function* () {
      const session = yield* awaited(
        createSession([
          (msa) => {
            msa.on("session_start", () => {
              msa.registerProvider("anthropic-api", {
                baseUrl: "http://localhost:8080/session-start",
              });
            });
          },
        ]),
      );

      yield* awaited(session.extensions.binding.bindExtensions({}));

      expect(session.model?.baseUrl).toBe("http://localhost:8080/session-start");
      expect(yield* awaited(capturePromptBaseUrl(session))).toBe(
        "http://localhost:8080/session-start",
      );

      session.dispose();
    }),
  );

const registersNativeMsaAiProvidersDuringExtension = () =>
  runTest(
    Effect.gen(function* () {
      const session = yield* awaited(
        createSession([
          (msa) => {
            msa.registerProvider(nativeAnthropicProvider("http://localhost:8080/native-top-level"));
          },
        ]),
      );

      expect(session.model?.baseUrl).toBe("http://localhost:8080/native-top-level");
      expect(yield* awaited(capturePromptBaseUrl(session))).toBe(
        "http://localhost:8080/native-top-level",
      );

      session.dispose();
    }),
  );

const appliesCommandTimeRegisterproviderOverridesWithoutReload = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const session = yield* awaited(
        createSession([
          (msa) => {
            msa.registerCommand("use-proxy", {
              description: "Use proxy",
              handler: () =>
                effectRunPromise(
                  Effect.sync(() => {
                    msa.registerProvider("anthropic-api", {
                      baseUrl: "http://localhost:8080/command",
                    });
                  }),
                ),
            });
          },
        ]),
      );

      yield* awaited(session.extensions.binding.bindExtensions({}));
      yield* awaited(session.run.prompting.prompt("/use-proxy"));

      expect(session.model?.baseUrl).toBe("http://localhost:8080/command");
      expect(yield* awaited(capturePromptBaseUrl(session))).toBe("http://localhost:8080/command");

      session.dispose();
    }),
  );

const registersNativeMsaAiProvidersAtCommand = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const session = yield* awaited(
        createSession([
          (msa) => {
            msa.registerCommand("use-native", {
              description: "Use native provider",
              handler: () =>
                effectRunPromise(
                  Effect.sync(() => {
                    msa.registerProvider(
                      nativeAnthropicProvider("http://localhost:8080/native-command"),
                    );
                  }),
                ),
            });
          },
        ]),
      );

      yield* awaited(session.extensions.binding.bindExtensions({}));
      yield* awaited(session.run.prompting.prompt("/use-native"));

      expect(session.model?.baseUrl).toBe("http://localhost:8080/native-command");
      expect(yield* awaited(capturePromptBaseUrl(session))).toBe(
        "http://localhost:8080/native-command",
      );

      session.dispose();
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = joinPath(
        tempRoot(),
        `msa-dynamic-provider-test-${currentTimeMillis()}-${randomSuffixSync()}`,
      );
      agentDir = joinPath(tempDir, "agent");
      yield* makeDirectory(agentDir);
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
        yield* removePath(tempDir);
      }
    }),
  );

describe("AgentSession dynamic provider registration", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it(
    "applies top-level registerProvider overrides to the active model",
    appliesTopLevelRegisterproviderOverridesToThe,
  );

  it(
    "applies session_start registerProvider overrides to the active model",
    appliesSessionStartRegisterproviderOverridesToThe,
  );

  it(
    "registers native msa-ai providers during extension loading",
    registersNativeMsaAiProvidersDuringExtension,
  );

  it(
    "applies command-time registerProvider overrides without reload",
    appliesCommandTimeRegisterproviderOverridesWithoutReload,
  );

  it("registers native msa-ai providers at command time", registersNativeMsaAiProvidersAtCommand);
});
