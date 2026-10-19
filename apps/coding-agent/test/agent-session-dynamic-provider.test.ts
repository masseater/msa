import type { Provider } from "@msa/ai";
import { getModel } from "@msa/ai/compat";
import {
  awaited,
  runTest,
  currentTimeMillis,
  randomSuffixSync,
  joinPath,
  pathExists,
  makeDirectory,
  removePath,
  tempRoot,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ExtensionFactory } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createAgentSession, DefaultResourceLoader, ModelRuntime } from "../src/index.ts";

function nativeAnthropicProvider(baseUrl: string): Provider {
  const model = { ...getModel("anthropic-api", "claude-sonnet-4-5")!, baseUrl };
  return {
    id: "anthropic-api",
    name: "Native Anthropic",
    baseUrl,
    auth: {
      apiKey: {
        name: "Test API key",
        resolve: () => runTest(awaited({ auth: { apiKey: "test-key" }, source: "test" })),
      },
    },
    getModels: () => [model],
    stream: () => {
      throw new Error("unused");
    },
    streamSimple: () => {
      throw new Error("unused");
    },
  };
}

describe("AgentSession dynamic provider registration", () => {
  let tempDir: string;
  let agentDir: string;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = joinPath(
          tempRoot(),
          `msa-dynamic-provider-test-${currentTimeMillis()}-${randomSuffixSync()}`,
        );
        agentDir = joinPath(tempDir, "agent");
        yield* makeDirectory(agentDir);
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
          yield* removePath(tempDir);
        }
      }),
    ),
  );

  function createSession(extensionFactories: ExtensionFactory[]) {
    return runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const settingsManager = SettingsManager.create(tempDir, agentDir);
        const sessionManager = SessionManager.inMemory();
        const authStorage = AuthStorage.create(joinPath(agentDir, "auth.json"));
        yield* awaited(
          authStorage.modify("anthropic-api", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "test-key" })),
          ),
        );
        const modelRuntime = yield* awaited(
          ModelRuntime.create({
            credentials: authStorage,
            modelsPath: joinPath(agentDir, "models.json"),
          }),
        );
        const resourceLoader = new DefaultResourceLoader({
          cwd: tempDir,
          agentDir,
          settingsManager,
          extensionFactories,
        });
        yield* awaited(resourceLoader.reload());

        const { session } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir,
            model: getModel("anthropic-api", "claude-sonnet-4-5")!,
            settingsManager,
            sessionManager,
            modelRuntime,
            resourceLoader,
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
        yield* awaited(session.prompt("hello"));
        return yield* awaited(baseUrl);
      }),
    );
  }

  it("applies top-level registerProvider overrides to the active model", () =>
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
        expect(yield* awaited(capturePromptBaseUrl(session))).toBe(
          "http://localhost:8080/top-level",
        );

        session.dispose();
      }),
    ));

  it("applies session_start registerProvider overrides to the active model", () =>
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

        yield* awaited(session.bindExtensions({}));

        expect(session.model?.baseUrl).toBe("http://localhost:8080/session-start");
        expect(yield* awaited(capturePromptBaseUrl(session))).toBe(
          "http://localhost:8080/session-start",
        );

        session.dispose();
      }),
    ));

  it("registers native msa-ai providers during extension loading", () =>
    runTest(
      Effect.gen(function* () {
        const session = yield* awaited(
          createSession([
            (msa) => {
              msa.registerProvider(
                nativeAnthropicProvider("http://localhost:8080/native-top-level"),
              );
            },
          ]),
        );

        expect(session.model?.baseUrl).toBe("http://localhost:8080/native-top-level");
        expect(yield* awaited(capturePromptBaseUrl(session))).toBe(
          "http://localhost:8080/native-top-level",
        );

        session.dispose();
      }),
    ));

  it("applies command-time registerProvider overrides without reload", () =>
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

        yield* awaited(session.bindExtensions({}));
        yield* awaited(session.prompt("/use-proxy"));

        expect(session.model?.baseUrl).toBe("http://localhost:8080/command");
        expect(yield* awaited(capturePromptBaseUrl(session))).toBe("http://localhost:8080/command");

        session.dispose();
      }),
    ));

  it("registers native msa-ai providers at command time", () =>
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

        yield* awaited(session.bindExtensions({}));
        yield* awaited(session.prompt("/use-native"));

        expect(session.model?.baseUrl).toBe("http://localhost:8080/native-command");
        expect(yield* awaited(capturePromptBaseUrl(session))).toBe(
          "http://localhost:8080/native-command",
        );

        session.dispose();
      }),
    ));
});
