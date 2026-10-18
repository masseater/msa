import { tmpdir } from "node:os";

import {
  type Api,
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Model,
  normalizeContext,
  type ProviderHeaders,
  type SimpleStreamOptions,
} from "@msa/ai";
import {
  awaited,
  runTest,
  currentTimeMillis,
  randomSuffixSync,
  joinPath,
  pathExists,
  makeDirectory,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { deleteEnv, writeEnv } from "../src/core/process-env.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createInMemoryModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";

describe("createAgentSession provider attribution headers", () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;
  let originalTelemetryEnv: string | undefined;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = joinPath(
          tmpdir(),
          `pi-sdk-attribution-test-${currentTimeMillis()}-${randomSuffixSync()}`,
        );
        cwd = joinPath(tempDir, "project");
        agentDir = joinPath(tempDir, "agent");
        yield* makeDirectory(cwd);
        yield* makeDirectory(agentDir);
        deleteEnv("MSA_TELEMETRY");
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        if (originalTelemetryEnv === undefined) {
          deleteEnv("MSA_TELEMETRY");
        } else {
          writeEnv("MSA_TELEMETRY", originalTelemetryEnv);
        }
        if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
          yield* removePath(tempDir);
        }
      }),
    ),
  );

  function createModel(
    provider: string,
    baseUrl: string,
    id = `${provider}-test-model`,
  ): Model<Api> {
    return {
      id,
      name: `${provider} Test Model`,
      api: "openai-completions" as const,
      provider,
      baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };
  }

  function createDoneStream() {
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text" as const, text: "ok" }],
      api: "openai-completions" as const,
      provider: "capture-provider",
      model: "capture-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: currentTimeMillis(),
    };
    stream.end(message);
    return stream;
  }

  function captureHeaders(
    model: Model<Api>,
    options: {
      telemetryEnabled?: boolean;
      providerHeaders?: Record<string, string>;
      requestHeaders?: Record<string, string>;
      sessionId?: string;
    } = {},
  ): Promise<ProviderHeaders | undefined> {
    return runTest(
      Effect.gen(function* () {
        const settingsManager = SettingsManager.create(cwd, agentDir);
        if (options.telemetryEnabled === false) {
          settingsManager.setEnableInstallTelemetry(false);
        }

        const authStorage = AuthStorage.inMemory({
          [model.provider]: { type: "api_key" as const, key: "test-api-key" },
        });
        const modelRegistry = yield* awaited(createInMemoryModelRegistry(authStorage));
        let capturedOptions: SimpleStreamOptions | undefined;

        modelRegistry.registerProvider(model.provider, {
          api: model.api,
          ...(options.providerHeaders === undefined ? {} : { headers: options.providerHeaders }),
          streamSimple: (_model, _context, providerOptions) => {
            capturedOptions = providerOptions;
            return createDoneStream();
          },
        });

        const modelRuntime = getModelRuntime(modelRegistry);
        const sessionManager = SessionManager.inMemory(cwd);
        if (options.sessionId !== undefined && options.sessionId.length > 0) {
          sessionManager.newSession({ id: options.sessionId });
        }

        const { session } = yield* awaited(
          createAgentSession({
            cwd,
            agentDir,
            model,
            modelRuntime,
            settingsManager,
            sessionManager,
          }),
        );

        try {
          const stream = yield* awaited(
            session.agent.streamFunction(model, normalizeContext({ messages: [] }), {
              sessionId: session.sessionId,
              ...(options.requestHeaders === undefined ? {} : { headers: options.requestHeaders }),
            }),
          );
          yield* awaited(stream.result());
          return yield* awaited(capturedOptions?.headers);
        } finally {
          session.dispose();
          modelRegistry.unregisterProvider(model.provider);
        }
      }),
    );
  }

  it("adds default attribution headers for OpenRouter models", () =>
    runTest(
      Effect.gen(function* () {
        const headers = yield* awaited(
          captureHeaders(createModel("openrouter", "https://openrouter.ai/api/v1")),
        );

        expect(headers?.["HTTP-Referer"]).toBe("https://pi.dev");
        expect(headers?.["X-OpenRouter-Title"]).toBe("pi");
        expect(headers?.["X-OpenRouter-Categories"]).toBe("cli-agent");
      }),
    ));

  it("does not add attribution headers when telemetry is disabled", () =>
    runTest(
      Effect.gen(function* () {
        const headers = yield* awaited(
          captureHeaders(createModel("openrouter", "https://openrouter.ai/api/v1"), {
            telemetryEnabled: false,
          }),
        );

        expect(headers?.["HTTP-Referer"]).toBeUndefined();
        expect(headers?.["X-OpenRouter-Title"]).toBeUndefined();
        expect(headers?.["X-OpenRouter-Categories"]).toBeUndefined();
      }),
    ));

  it("adds attribution headers for custom providers routed through OpenRouter", () =>
    runTest(
      Effect.gen(function* () {
        const headers = yield* awaited(
          captureHeaders(createModel("custom-openrouter", "https://openrouter.ai/api/v1")),
        );

        expect(headers?.["HTTP-Referer"]).toBe("https://pi.dev");
        expect(headers?.["X-OpenRouter-Title"]).toBe("pi");
        expect(headers?.["X-OpenRouter-Categories"]).toBe("cli-agent");
      }),
    ));

  it("preserves legacy OpenRouter base URL substring attribution matching", () =>
    runTest(
      Effect.gen(function* () {
        const headers = yield* awaited(
          captureHeaders(createModel("custom-openrouter", "not-a-url-openrouter.ai")),
        );

        expect(headers?.["HTTP-Referer"]).toBe("https://pi.dev");
        expect(headers?.["X-OpenRouter-Title"]).toBe("pi");
        expect(headers?.["X-OpenRouter-Categories"]).toBe("cli-agent");
      }),
    ));

  it("lets provider and request headers override the defaults", () =>
    runTest(
      Effect.gen(function* () {
        const headers = yield* awaited(
          captureHeaders(createModel("openrouter", "https://openrouter.ai/api/v1"), {
            providerHeaders: {
              "HTTP-Referer": "https://provider.example",
              "X-OpenRouter-Categories": "provider-category",
            },
            requestHeaders: {
              "X-OpenRouter-Title": "request-title",
            },
          }),
        );

        expect(headers?.["HTTP-Referer"]).toBe("https://provider.example");
        expect(headers?.["X-OpenRouter-Title"]).toBe("request-title");
        expect(headers?.["X-OpenRouter-Categories"]).toBe("provider-category");
      }),
    ));

  it("adds OpenCode session headers", () =>
    runTest(
      Effect.gen(function* () {
        const headers = yield* awaited(
          captureHeaders(createModel("opencode", "https://opencode.ai/zen/v1"), {
            sessionId: "opencode-session",
          }),
        );

        expect(headers?.["x-opencode-session"]).toBe("opencode-session");
        expect(headers?.["x-opencode-client"]).toBe("pi");
      }),
    ));

  it("lets configured OpenCode headers override the defaults", () =>
    runTest(
      Effect.gen(function* () {
        const headers = yield* awaited(
          captureHeaders(createModel("opencode", "https://opencode.ai/zen/v1"), {
            sessionId: "opencode-session",
            providerHeaders: {
              "x-opencode-session": "configured-session",
              "x-opencode-client": "configured-client",
            },
          }),
        );

        expect(headers?.["x-opencode-session"]).toBe("configured-session");
        expect(headers?.["x-opencode-client"]).toBe("configured-client");
      }),
    ));
});
