import * as NodeServices from "@effect/platform-node/NodeServices";
import { Agent } from "@msa/agent-core";
import { fauxAssistantMessage, registerFauxProvider, streamSimple } from "@msa/ai/compat";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { Model } from "../../../../../libs/ai/src/model-types.ts";
import type { FauxProviderRegistration } from "../../../../../libs/ai/src/providers/faux-types.ts";
import { AgentSession } from "../../../src/core/agent-session.ts";
import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { convertToLlm } from "../../../src/core/messages.ts";
import { ModelRegistry } from "../../../src/core/model-registry.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";
import { initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import { createInMemoryModelRegistry, getModelRuntime } from "../../model-runtime-test-utils.ts";
import { join } from "../../test-path.ts";
import { createTestResourceLoader } from "../../utilities.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const cleanups: Array<() => void> = [];

const exportsWithTheActiveFallbackTheme = Effect.gen(function* () {
  const tempDir = yield* fs.makeTempDirectory({ prefix: "msa-5596-" });
  const faux = registerFauxProvider({
    models: [{ id: "faux-1", reasoning: false }],
  });
  faux.setResponses([fauxAssistantMessage("hello")]);
  const model = faux.getModel();
  const authStorage = AuthStorage.inMemory();
  yield* Effect.promise(() =>
    authStorage.modify(model.provider, () => Promise.resolve({ type: "api_key", key: "faux-key" })),
  );
  const modelRegistry = yield* Effect.promise(() => createInMemoryModelRegistry(authStorage));
  modelRegistry.registerProvider(model.provider, {
    baseUrl: model.baseUrl,
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
      baseUrl: registeredModel.baseUrl,
    })),
  });
  const settingsManager = SettingsManager.inMemory({ theme: "missing-theme" });
  return yield* exportsWithTheActiveFallbackThemePart2(
    tempDir,
    faux,
    model,
    modelRegistry,
    settingsManager,
  );
});

const exportsWithTheActiveFallbackThemePart2 = (
  tempDir: string,
  faux: FauxProviderRegistration,
  model: Model<string>,
  modelRegistry: ModelRegistry,
  settingsManager: SettingsManager,
) =>
  Effect.gen(function* () {
    const sessionManager = SessionManager.create(tempDir, join(tempDir, "sessions"));
    const agent = new Agent({
      getApiKey: () => "faux-key",
      initialState: {
        model,
        systemPrompt: "You are a test assistant.",
        tools: [],
      },
      convertToLlm,
      streamFn: streamSimple,
    });
    const session = new AgentSession({
      agent,
      sessionManager,
      settingsManager,
      cwd: tempDir,
      modelRuntime: getModelRuntime(modelRegistry),
      resourceLoader: createTestResourceLoader(),
    });
    return yield* exportsWithTheActiveFallbackThemePart3(tempDir, faux, settingsManager, session);
  });

const exportsWithTheActiveFallbackThemePart3 = (
  tempDir: string,
  faux: FauxProviderRegistration,
  settingsManager: SettingsManager,
  session: AgentSession,
) =>
  Effect.gen(function* () {
    cleanups.push(() =>
      runtime.runPromise(
        Effect.gen(function* () {
          session.dispose();
          faux.unregister();
          if (yield* fs.exists(tempDir)) {
            yield* fs.remove(tempDir, { recursive: true, force: true });
          }
        }),
      ),
    );
    yield* Effect.promise(() => session.prompt("hi"));
    initTheme(settingsManager.getTheme());
    const outputPath = join(tempDir, "export.html");
    yield* Effect.promise(() => expect(session.exportToHtml(outputPath)).resolves.toBe(outputPath));
    expect(yield* fs.exists(outputPath)).toBe(true);
    expect(settingsManager.getTheme()).toBe("missing-theme");
  });

describe("regression #5596: missing configured theme export", () => {
  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    initTheme("dark");
  });
  it("exports with the active fallback theme when the configured theme is missing", () =>
    Effect.runPromise(exportsWithTheActiveFallbackTheme));
});
