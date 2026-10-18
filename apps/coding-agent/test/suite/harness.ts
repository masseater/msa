import * as NodeServices from "@effect/platform-node/NodeServices";
import type { AgentMessage, AgentTool } from "@msa/agent-core";
import { Agent } from "@msa/agent-core";
import type {
  FauxModelDefinition,
  FauxProviderRegistration,
  FauxResponseStep,
  Model,
  ToolResultMessage,
} from "@msa/ai/compat";
import { registerFauxProvider, streamSimple } from "@msa/ai/compat";
import { joinPath, toJsonText } from "@msa/testing";
import { Effect, FileSystem, Function, ManagedRuntime } from "effect";

import { AgentSession, type AgentSessionEvent } from "../../src/core/agent-session.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import type { ExtensionRunner, ExtensionUIContext } from "../../src/core/extensions/index.ts";
import { convertToLlm } from "../../src/core/messages.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import type { InlineExtension, ResourceLoader } from "../../src/index.ts";
import { theme } from "../../src/modes/interactive/theme/theme.ts";
import {
  createInMemoryModelRegistry,
  createModelRegistry,
  getModelRuntime,
} from "../model-runtime-test-utils.ts";
import {
  type CreateTestExtensionsResultInput,
  createTestExtensionsResult,
  createTestResourceLoader,
} from "../utilities.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

type MessageTextPart = { type: "text"; text: string };

export function getMessageText(message: unknown): string {
  if (
    message === undefined ||
    message === null ||
    typeof message !== "object" ||
    !("content" in message)
  ) {
    return "";
  }
  const content = (message as { content?: string | Array<{ type: string; text?: string }> })
    .content;
  if (content === undefined) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part): part is MessageTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function getUserTexts(harness: Harness): string[] {
  return harness.session.messages
    .filter((message) => message.role === "user")
    .map((message) => getMessageText(message));
}

export function getAssistantTexts(harness: Harness): string[] {
  return harness.session.messages
    .filter((message) => message.role === "assistant")
    .map((message) => getMessageText(message));
}

export const getToolResult: {
  (harness: Harness, toolName: string): ToolResultMessage;
  (toolName: string): (harness: Harness) => ToolResultMessage;
} = Function.dual(2, (harness: Harness, toolName: string): ToolResultMessage => {
  const result = harness.session.messages.findLast(
    (message): message is ToolResultMessage =>
      message.role === "toolResult" && message.toolName === toolName,
  );
  if (result === undefined) throw new Error(`No ${toolName} tool result`);
  return result;
});

export function createTestUiContext(
  overrides: Partial<ExtensionUIContext> = {},
): ExtensionUIContext {
  return {
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
    input: () => Promise.resolve(undefined),
    notify: () => {},
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: <T>() => Promise.resolve(undefined as T),
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    editor: () => Promise.resolve(undefined),
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      return theme;
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Theme switching not available in tests" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
    ...overrides,
  };
}

export interface HarnessOptions {
  models?: FauxModelDefinition[];
  settings?: Partial<Settings>;
  tools?: AgentTool[];
  initialActiveToolNames?: string[];
  allowedToolNames?: string[] | undefined;
  excludedToolNames?: string[] | undefined;
  resourceLoader?: ResourceLoader;
  extensionFactories?: Array<InlineExtension | CreateTestExtensionsResultInput> | undefined;
  withConfiguredAuth?: boolean;
  modelsJson?: Record<string, unknown>;

  sessionManager?: SessionManager | undefined;
}

export interface Harness {
  session: AgentSession;
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
  authStorage: AuthStorage;
  faux: FauxProviderRegistration;
  models: [Model<string>, ...Model<string>[]];
  getModel(): Model<string>;
  getModel(modelId: string): Model<string> | undefined;
  setResponses: (responses: FauxResponseStep[]) => void;
  appendResponses: (responses: FauxResponseStep[]) => void;
  getPendingResponseCount: () => number;
  events: AgentSessionEvent[];
  eventsOfType<T extends AgentSessionEvent["type"]>(
    type: T,
  ): Extract<AgentSessionEvent, { type: T }>[];
  tempDir: string;
  cleanup: () => void;
}

function createTempDir() {
  return runtime.runPromise(
    Effect.gen(function* () {
      const tempDir = yield* fs.makeTempDirectory({ prefix: `msa-suite-` });
      yield* fs.makeDirectory(tempDir, { recursive: true });
      return tempDir;
    }),
  );
}

export function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const tempDir = yield* Effect.promise(() => createTempDir());
      const fauxProvider: FauxProviderRegistration = registerFauxProvider(
        options.models === undefined ? {} : { models: options.models },
      );
      fauxProvider.setResponses([]);
      const model = fauxProvider.getModel();
      const toolMap =
        options.tools === undefined
          ? undefined
          : Object.fromEntries(options.tools.map((tool) => [tool.name, tool]));
      const withConfiguredAuth = options.withConfiguredAuth ?? true;
      const extensionRunnerRef: { current?: ExtensionRunner } = {};

      const sessionManager = options.sessionManager ?? SessionManager.inMemory();
      const settingsManager = SettingsManager.inMemory({
        memory: { database: joinPath(tempDir, "memory.db"), embedding: { enabled: false } },
        ...options.settings,
      });

      const authStorage = AuthStorage.inMemory();
      if (withConfiguredAuth) {
        yield* Effect.promise(() =>
          authStorage.modify(model.provider, () =>
            Promise.resolve({ type: "api_key", key: "faux-key" }),
          ),
        );
      }
      const modelsPath =
        options.modelsJson === undefined ? undefined : joinPath(tempDir, "models.json");
      if (modelsPath !== undefined && modelsPath !== "")
        yield* fs.writeFileString(modelsPath, yield* toJsonText(options.modelsJson));
      const modelRegistry =
        modelsPath !== undefined && modelsPath !== ""
          ? yield* Effect.promise(() => createModelRegistry(authStorage, modelsPath))
          : yield* Effect.promise(() => createInMemoryModelRegistry(authStorage));
      if (withConfiguredAuth) {
        modelRegistry.registerProvider(model.provider, {
          baseUrl: model.baseUrl,
          apiKey: "faux-key",
          api: fauxProvider.api,
          models: fauxProvider.models.map((registeredModel) => ({
            id: registeredModel.id,
            name: registeredModel.name,
            api: registeredModel.api,
            reasoning: registeredModel.reasoning,
            input: registeredModel.input,
            ...(registeredModel.inputLimits === undefined
              ? {}
              : { inputLimits: registeredModel.inputLimits }),
            cost: registeredModel.cost,
            contextWindow: registeredModel.contextWindow,
            maxTokens: registeredModel.maxTokens,
            baseUrl: registeredModel.baseUrl,
          })),
        });
      }

      const agent = new Agent({
        getApiKey: () => (withConfiguredAuth ? "faux-key" : undefined),
        streamFn: streamSimple,
        initialState: {
          model,
          systemPrompt: "",
          tools: [],
        },
        convertToLlm,
        onPayload: (payload) =>
          runPromise(
            Effect.sync(() => {
              const runner = extensionRunnerRef.current;
              if (runner?.hasHandlers("before_provider_request") !== true) {
                return payload;
              }
              return runner.emitBeforeProviderRequest(payload);
            }),
          ),
        onResponse: (response) =>
          runPromise(
            Effect.gen(function* () {
              const runner = extensionRunnerRef.current;
              if (runner?.hasHandlers("after_provider_response") !== true) {
                return;
              }
              yield* Effect.promise(() =>
                runner.emit({
                  type: "after_provider_response",
                  status: response.status,
                  headers: response.headers,
                }),
              );
            }),
          ),
        transformContext: (messages: AgentMessage[]) =>
          runPromise(
            Effect.promise(() => {
              const runner = extensionRunnerRef.current;
              if (runner === undefined) return Promise.resolve(messages);
              return runner.emitContext(messages);
            }),
          ),
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
          return runtime.runPromise(
            Effect.gen(function* () {
              session.dispose();
              fauxProvider.unregister();
              if (yield* fs.exists(tempDir)) {
                yield* fs.remove(tempDir, { recursive: true });
              }
            }),
          );
        },
      };
    }),
  );
}
