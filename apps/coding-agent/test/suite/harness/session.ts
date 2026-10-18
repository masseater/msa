import { Effect } from "effect";

import { AgentSession } from "../../../src/core/agent-session.ts";
import type { AgentSessionEvent } from "../../../src/core/agent-session.ts";
import type { ExtensionRunner } from "../../../src/core/extensions/index.ts";
import { getModelRuntime } from "../../model-runtime-test-utils.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../../utilities.ts";
import { createFauxAgent } from "./agent.ts";
import {
  createAuthStorage,
  createFauxProvider,
  createRegistry,
  modelsPathFor,
  registerFauxModels,
  writeModelsJson,
} from "./auth.ts";
import { createTempDir, removeTempDir } from "./runtime.ts";
import { createSessionManager, createSettingsManager } from "./state.ts";
import type { Harness, HarnessOptions } from "./types.ts";

export function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const tempDir = yield* Effect.promise(() => createTempDir());
      const fauxProvider = createFauxProvider(options.models);
      const model = fauxProvider.getModel();
      const toolMap =
        options.tools === undefined
          ? undefined
          : Object.fromEntries(options.tools.map((tool) => [tool.name, tool]));
      const withConfiguredAuth = options.withConfiguredAuth ?? true;
      const extensionRunnerRef: { current?: ExtensionRunner } = {};

      const sessionManager = createSessionManager(options.sessionManager);
      const settingsManager = createSettingsManager({ tempDir, settings: options.settings });
      const authStorage = yield* Effect.promise(() =>
        createAuthStorage({ provider: model.provider, withConfiguredAuth }),
      );
      const modelsPath = modelsPathFor({ tempDir, modelsJson: options.modelsJson });
      if (modelsPath !== undefined && modelsPath !== "" && options.modelsJson !== undefined) {
        yield* Effect.promise(() =>
          writeModelsJson({ modelsPath, modelsJson: options.modelsJson ?? {} }),
        );
      }
      const modelRegistry = yield* Effect.promise(() =>
        createRegistry({ authStorage, modelsPath }),
      );
      if (withConfiguredAuth) registerFauxModels({ modelRegistry, model, fauxProvider });

      const agent = createFauxAgent({
        model,
        fauxProvider,
        withConfiguredAuth,
        extensionRunnerRef,
      });
      const extensionsResult =
        options.extensionFactories === undefined
          ? undefined
          : yield* Effect.promise(() =>
              createTestExtensionsResult(options.extensionFactories ?? [], tempDir),
            );
      const resourceLoader =
        options.resourceLoader ??
        createTestResourceLoader(extensionsResult === undefined ? undefined : { extensionsResult });

      const session = new AgentSession({
        agent,
        sessionManager,
        settingsManager,
        cwd: tempDir,
        modelRuntime: getModelRuntime(modelRegistry),
        resourceLoader,
        ...(toolMap === undefined ? {} : { baseToolsOverride: toolMap }),
        ...(options.initialActiveToolNames === undefined
          ? {}
          : { initialActiveToolNames: options.initialActiveToolNames }),
        usesDefaultTools: options.initialActiveToolNames === undefined,
        ...(options.allowedToolNames === undefined
          ? {}
          : { allowedToolNames: options.allowedToolNames }),
        ...(options.excludedToolNames === undefined
          ? {}
          : { excludedToolNames: options.excludedToolNames }),
        extensionRunnerRef,
      });

      const events: AgentSessionEvent[] = [];
      session.subscribe((event) => {
        events.push(event);
      });

      return {
        session,
        sessionManager,
        settingsManager,
        authStorage,
        faux: fauxProvider,
        models: fauxProvider.models,
        getModel: fauxProvider.getModel,
        setResponses: fauxProvider.setResponses,
        appendResponses: fauxProvider.appendResponses,
        getPendingResponseCount: fauxProvider.getPendingResponseCount,
        events,
        eventsOfType<T extends AgentSessionEvent["type"]>(type: T) {
          return events.filter(
            (event): event is Extract<AgentSessionEvent, { type: T }> => event.type === type,
          );
        },
        tempDir,
        cleanup() {
          session.dispose();
          fauxProvider.unregister();
          void removeTempDir(tempDir);
        },
      };
    }),
  );
}
