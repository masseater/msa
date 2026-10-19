import { Agent } from "@msa/agent-core";
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  getModel,
  type Model,
} from "@msa/ai/compat";
import {
  awaited,
  currentTimeMillis,
  joinPath,
  makeTempDir,
  randomSuffix,
  removePath,
  toJsonText,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";

import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createInMemoryModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

function createAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic-api",
    model: "claude-sonnet-4-5",
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
}

const pushAfter = (ms: number, push: () => void): void => {
  Effect.runFork(Effect.sleep(ms).pipe(Effect.andThen(Effect.sync(push))));
};

type ResourceLoaderOptions = NonNullable<Parameters<typeof createTestResourceLoader>[0]>;

export interface RuntimeHostOptions {
  withAuth: boolean;
  responseDelayMs: number;
  model?: Model<any>;
  extensionsResult?: NonNullable<ResourceLoaderOptions["extensionsResult"]>;
}

export const createRuntimeHost = (
  options: RuntimeHostOptions,
): Effect.Effect<{
  runtimeHost: Record<string, unknown> & { session: AgentSession };
  cleanup: Effect.Effect<void>;
}> =>
  Effect.gen(function* () {
    const tempDir = yield* makeTempDir(`msa-rpc-prompt-${yield* randomSuffix}-`);
    yield* writeTextFile(
      joinPath(tempDir, "settings.json"),
      yield* toJsonText({ memory: { enabled: false } }),
    );

    const model = options.model ?? getModel("anthropic-api", "claude-sonnet-4-5");
    if (model === undefined) {
      throw new Error("Test model not found");
    }

    const agent = new Agent({
      getApiKey: () => "test-key",
      initialState: {
        model,
        systemPrompt: "Test",
        tools: [],
      },
      streamFn: (_model, _context, _options) => {
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: "start", partial: createAssistantMessage("") });
          pushAfter(options.responseDelayMs, () => {
            stream.push({
              type: "done",
              reason: "stop",
              message: createAssistantMessage("done"),
            });
          });
        });
        return stream;
      },
    });

    const sessionManager = SessionManager.inMemory();
    const settingsManager = SettingsManager.create(tempDir, tempDir);
    const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
    const modelRegistry = yield* awaited(createInMemoryModelRegistry(authStorage));
    if (options.withAuth) {
      yield* awaited(
        authStorage.modify("anthropic-api", () =>
          Promise.resolve({ type: "api_key" as const, key: "test-key" }),
        ),
      );
    }

    const session = new AgentSession({
      agent,
      sessionManager,
      settingsManager,
      cwd: tempDir,
      modelRuntime: getModelRuntime(modelRegistry),
      resourceLoader: createTestResourceLoader(
        options.extensionsResult === undefined
          ? {}
          : { extensionsResult: options.extensionsResult },
      ),
    });

    const runtimeHost = {
      session,
      newSession: () => Promise.resolve({ cancelled: true }),
      switchSession: () => Promise.resolve({ cancelled: true }),
      fork: () => Promise.resolve({ cancelled: true, selectedText: "" }),
      dispose: () => Promise.resolve(),
      setRebindSession: () => {},
    };

    const cleanup = Effect.gen(function* () {
      yield* Effect.ignore(awaited(session.abort()));
      session.dispose();
      yield* removePath(tempDir);
    });

    return { runtimeHost, cleanup };
  });
