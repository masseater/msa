import type runnerContextTypes from "./runner-context.types.ts";
import type extensionsTypesTypes from "./types.types.ts";

export default class ContextFactory {
  private readonly host: runnerContextTypes.ContextHost;

  constructor(host: runnerContextTypes.ContextHost) {
    this.host = host;
  }

  createContext(): extensionsTypesTypes.ExtensionContext {
    const { host } = this;
    const { bindings } = host;
    const guarded = <T>(read: () => T): T => {
      host.assertActive();
      return read();
    };
    return {
      abort: () => guarded(() => bindings.abortFn()),
      compact: (options) => guarded(() => bindings.compactFn(options)),
      get cwd() {
        return guarded(() => host.cwd);
      },
      getContextUsage: () => guarded(() => bindings.getContextUsageFn()),
      getSystemPrompt: () => guarded(() => bindings.getSystemPromptFn()),
      hasPendingMessages: () => guarded(() => bindings.hasPendingMessagesFn()),
      get hasUI() {
        return guarded(() => host.hasUI());
      },
      isIdle: () => guarded(() => bindings.isIdleFn()),
      isProjectTrusted: () => guarded(() => bindings.isProjectTrustedFn()),
      get mode() {
        return guarded(() => host.mode());
      },
      get model() {
        return guarded(() => bindings.getModel());
      },
      get modelRegistry() {
        return guarded(() => host.modelRegistry);
      },
      get scopedModels() {
        return guarded(() => bindings.getScopedModels());
      },
      get sessionManager() {
        return guarded(() => host.sessionManager);
      },
      shutdown: () => guarded(() => bindings.shutdownHandler()),
      get signal() {
        return guarded(() => bindings.getSignalFn());
      },
      get thinkingLevel() {
        return guarded(() => host.runtime.getThinkingLevel());
      },
      get ui() {
        return guarded(() => host.ui());
      },
    };
  }

  createToolContext(
    toolCallId: string,
    signal: AbortSignal | undefined,
  ): extensionsTypesTypes.ExtensionToolContext {
    const { host } = this;
    return Object.defineProperties(
      this.createContext() as extensionsTypesTypes.ExtensionToolContext,
      {
        executeTool: {
          value: (
            name: string,
            args: unknown,
            options: extensionsTypesTypes.ExecuteToolOptions = {},
          ) => {
            host.assertActive();
            const { executeToolFn } = host.bindings;
            if (executeToolFn === undefined) {
              return Promise.resolve({
                isError: true,
                result: {
                  content: [
                    { text: "Nested tool calls are not available in this context", type: "text" },
                  ],
                  details: {},
                },
                toolCall: { arguments: {}, id: `${toolCallId}/0`, name, type: "toolCall" },
              });
            }
            return executeToolFn(toolCallId, name, args, {
              ...options,
              signal: options.signal ?? signal,
            });
          },
        },
        tools: {
          get() {
            host.assertActive();
            return host.bindings.getCallableToolsFn();
          },
        },
      },
    );
  }

  createCommandContext(): extensionsTypesTypes.ExtensionCommandContext {
    const { host } = this;
    const { bindings } = host;
    const context = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(this.createContext()),
    ) as extensionsTypesTypes.ExtensionCommandContext;
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
