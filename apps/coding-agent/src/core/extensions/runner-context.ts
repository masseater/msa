import type { ModelRegistry } from "../model-registry.ts";
import type { SessionManager } from "../session-manager.ts";
import type { RunnerBindings } from "./runner-bindings.ts";
import type {
  ExecuteToolOptions,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionMode,
  ExtensionRuntime,
  ExtensionToolContext,
  ExtensionUIContext,
} from "./types.ts";

export interface ContextHost {
  assertActive: () => void;
  ui: () => ExtensionUIContext;
  mode: () => ExtensionMode;
  hasUI: () => boolean;
  cwd: string;
  sessionManager: SessionManager;
  modelRegistry: ModelRegistry;
  runtime: ExtensionRuntime;
  bindings: RunnerBindings;
}

export class ContextFactory {
  private readonly host: ContextHost;

  constructor(host: ContextHost) {
    this.host = host;
  }

  createContext(): ExtensionContext {
    const { host } = this;
    const { bindings } = host;
    const guarded = <T>(read: () => T): T => {
      host.assertActive();
      return read();
    };
    return {
      get ui() {
        return guarded(() => host.ui());
      },
      get mode() {
        return guarded(() => host.mode());
      },
      get hasUI() {
        return guarded(() => host.hasUI());
      },
      get cwd() {
        return guarded(() => host.cwd);
      },
      get sessionManager() {
        return guarded(() => host.sessionManager);
      },
      get modelRegistry() {
        return guarded(() => host.modelRegistry);
      },
      get model() {
        return guarded(() => bindings.getModel());
      },
      get scopedModels() {
        return guarded(() => bindings.getScopedModels());
      },
      get thinkingLevel() {
        return guarded(() => host.runtime.getThinkingLevel());
      },
      isIdle: () => guarded(() => bindings.isIdleFn()),
      isProjectTrusted: () => guarded(() => bindings.isProjectTrustedFn()),
      get signal() {
        return guarded(() => bindings.getSignalFn());
      },
      abort: () => guarded(() => bindings.abortFn()),
      hasPendingMessages: () => guarded(() => bindings.hasPendingMessagesFn()),
      shutdown: () => guarded(() => bindings.shutdownHandler()),
      getContextUsage: () => guarded(() => bindings.getContextUsageFn()),
      compact: (options) => guarded(() => bindings.compactFn(options)),
      getSystemPrompt: () => guarded(() => bindings.getSystemPromptFn()),
    };
  }

  createToolContext(toolCallId: string, signal: AbortSignal | undefined): ExtensionToolContext {
    const { host } = this;
    return Object.defineProperties(this.createContext() as ExtensionToolContext, {
      tools: {
        get() {
          host.assertActive();
          return host.bindings.getCallableToolsFn();
        },
      },
      executeTool: {
        value: (name: string, args: unknown, options: ExecuteToolOptions = {}) => {
          host.assertActive();
          const { executeToolFn } = host.bindings;
          if (executeToolFn === undefined) {
            return Promise.resolve({
              toolCall: { type: "toolCall", id: `${toolCallId}/0`, name, arguments: {} },
              result: {
                content: [
                  { type: "text", text: "Nested tool calls are not available in this context" },
                ],
                details: {},
              },
              isError: true,
            });
          }
          return executeToolFn(toolCallId, name, args, {
            ...options,
            signal: options.signal ?? signal,
          });
        },
      },
    });
  }

  createCommandContext(): ExtensionCommandContext {
    const { host } = this;
    const { bindings } = host;
    const context = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(this.createContext()),
    ) as ExtensionCommandContext;
    const guarded = <T>(read: () => T): T => {
      host.assertActive();
      return read();
    };
    context.getSystemPromptOptions = () => guarded(() => bindings.getSystemPromptOptionsFn());
    context.waitForIdle = () => guarded(() => bindings.waitForIdleFn());
    context.newSession = (options) => guarded(() => bindings.newSessionHandler(options));
    context.fork = (entryId, options) => guarded(() => bindings.forkHandler(entryId, options));
    context.navigateTree = (targetId, options) =>
      guarded(() => bindings.navigateTreeHandler(targetId, options));
    context.switchSession = (sessionPath, options) =>
      guarded(() => bindings.switchSessionHandler(sessionPath, options));
    context.reload = () => guarded(() => bindings.reloadHandler());
    return context;
  }
}
