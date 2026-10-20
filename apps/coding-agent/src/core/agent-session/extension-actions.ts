import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import type extensionsTypes from "../extensions/index.types.ts";

export default class SessionExtensionActions {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  private providerActions(): Parameters<extensionsTypes.ExtensionRunner["bindCore"]>[2] {
    const thenRefresh =
      <A extends unknown[]>(change: (...args: A) => void) =>
      (...args: A) => {
        change(...args);
        this.session.models.selection.refreshCurrentModelFromRegistry();
      };
    const runtime = this.session.models.selection.modelRuntimeInternal;
    return {
      registerNativeProvider: thenRefresh((provider) => runtime.registerNativeProvider(provider)),
      registerProvider: thenRefresh((name, config) => runtime.registerProvider(name, config)),
      registerVirtualModel: thenRefresh((definition) => runtime.registerVirtualModel(definition)),
      unregisterProvider: thenRefresh((name) => runtime.unregisterProvider(name)),
      unregisterVirtualModel: thenRefresh((provider, id) =>
        runtime.unregisterVirtualModel(provider, id),
      ),
    };
  }

  private contextActions(): Parameters<extensionsTypes.ExtensionRunner["bindCore"]>[1] {
    return {
      abort: () => {
        if (this.session.extensions.binding.extensionAbortHandler !== undefined) {
          this.session.extensions.binding.extensionAbortHandler();
          return;
        }
        void this.session.run.lifecycle.abort();
      },
      compact: (options) => {
        this.session.compaction.manual
          .compact(options?.customInstructions)
          .then((result) => options?.onComplete?.(result))
          .catch((error: unknown) =>
            options?.onError?.(error instanceof Error ? error : new Error(String(error))),
          );
      },
      executeTool: (callerId, name, args, options) =>
        Effect.runPromise(
          this.session.tools.calls.executeNestedToolCall(callerId, name, args, options),
        ),
      getCallableTools: () => this.session.tools.loadout.getCallableTools(),
      getContextUsage: () => this.session.context.stats.getContextUsage(),
      getModel: () => this.session.model,
      getScopedModels: () => this.session.models.selection.scopedModelsInternal,
      getSignal: () => this.session.agent.signal,
      getSystemPrompt: () => this.session.tools.prompt.systemPrompt,
      getSystemPromptOptions: () => this.session.tools.prompt.baseSystemPromptOptions,
      hasPendingMessages: () => this.session.run.queue.pendingMessageCount > 0,
      isIdle: () => this.session.isIdle,
      isProjectTrusted: () => this.session.settingsManager.isProjectTrusted(),
      shutdown: () => {
        this.session.extensions.binding.extensionShutdownHandler?.();
      },
    };
  }

  private coreActions(
    runner: extensionsTypes.ExtensionRunner,
  ): Parameters<extensionsTypes.ExtensionRunner["bindCore"]>[0] {
    return {
      appendEntry: (customType, data) => {
        const entry = this.session.sessionManager.getEntry(
          this.session.sessionManager.appendCustomEntry(customType, data),
        );
        if (entry !== undefined) this.session.emit({ entry, type: "entry_appended" });
      },
      getActiveTools: () => this.session.tools.loadout.getActiveToolNames(),
      getAllTools: () => this.session.tools.registry.getAllTools(),
      getCommands: () => this.session.commands.slash.slashCommandInfos(runner),
      getSessionName: () => this.session.sessionManager.getSessionName(),
      getSettings: () => this.session.settingsManager.getSettings(),
      getThinkingLevel: () => this.session.thinkingLevel,
      refreshTools: () => this.session.tools.registry.refreshToolRegistry(),
      sendMessage: (message, options) => {
        this.session.run.prompting
          .sendCustomMessage(message, options)
          .catch(this.session.extensions.binding.reportRuntimeError(runner, "send_message"));
      },
      sendUserMessage: (content, options) => {
        this.session.run.prompting
          .sendUserMessage(content, options)
          .catch(this.session.extensions.binding.reportRuntimeError(runner, "send_user_message"));
      },
      setActiveTools: (toolNames) => this.session.tools.loadout.setActiveToolsByName(toolNames),
      setLabel: (entryId, label) => {
        this.session.sessionManager.appendLabelChange(entryId, label);
      },
      setModel: (model) =>
        this.session.models.selection.modelRuntimeInternal.hasConfiguredAuth(model.provider)
          ? this.session.models.selection.setModel(model).then(() => true)
          : Promise.resolve(false),
      setSessionName: (name) => {
        this.session.context.transcript.setSessionName(name);
      },
      setThinkingLevel: (level) => this.session.models.thinking.setThinkingLevel(level),
    };
  }

  bindExtensionCore(runner: extensionsTypes.ExtensionRunner): void {
    runner.bindCore(this.coreActions(runner), this.contextActions(), this.providerActions());
  }
}
