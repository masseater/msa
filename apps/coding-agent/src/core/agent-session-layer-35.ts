import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import AgentSessionLayer34 from "./agent-session-layer-34.ts";
import awaitingModule from "./awaiting.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import runnerEvents from "./extensions/runner-events.ts";
import settingsManagerSupport from "./settings-manager-support.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { DEFAULT_TOOL_NAMES, applyToolModifiers } = settingsManagerSupport;
const { emitSessionShutdownEvent } = runnerEvents;
const { resetApiProviders } = compat;

export default abstract class AgentSessionLayer35 extends AgentSessionLayer34 {
  sendUserMessage(
    content: string | (compatTypes.TextContent | compatTypes.ImageContent)[],
    options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean },
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        let text: string;
        let images: compatTypes.ImageContent[] | undefined;

        if (typeof content === "string") {
          text = content;
        } else {
          const textParts: string[] = [];
          images = [];
          for (const part of content) {
            if (part.type === "text") {
              textParts.push(part.text);
            } else {
              images.push(part);
            }
          }
          text = textParts.join("\n");
          if (images.length === 0) images = undefined;
        }

        yield* awaited(
          this.prompt(text, {
            expandPromptTemplates: options?.expandPromptTemplates ?? false,
            images,
            source: "extension",
            streamingBehavior: options?.deliverAs,
          }),
        );
      }, this),
    );
  }

  protected coreActions(
    runner: extensionsTypes.ExtensionRunner,
  ): Parameters<extensionsTypes.ExtensionRunner["bindCore"]>[0] {
    return {
      appendEntry: (customType, data) => {
        const entry = this.sessionManager.getEntry(
          this.sessionManager.appendCustomEntry(customType, data),
        );
        if (entry !== undefined) this.emit({ entry, type: "entry_appended" });
      },
      getActiveTools: () => this.getActiveToolNames(),
      getAllTools: () => this.getAllTools(),
      getCommands: () => this.slashCommandInfos(runner),
      getSessionName: () => this.sessionManager.getSessionName(),
      getSettings: () => this.settingsManager.getSettings(),
      getThinkingLevel: () => this.thinkingLevel,
      refreshTools: () => this.refreshToolRegistry(),
      sendMessage: (message, options) => {
        this.sendCustomMessage(message, options).catch(
          this.reportRuntimeError(runner, "send_message"),
        );
      },
      sendUserMessage: (content, options) => {
        this.sendUserMessage(content, options).catch(
          this.reportRuntimeError(runner, "send_user_message"),
        );
      },
      setActiveTools: (toolNames) => this.setActiveToolsByName(toolNames),
      setLabel: (entryId, label) => {
        this.sessionManager.appendLabelChange(entryId, label);
      },
      setModel: (model) =>
        this.modelRuntimeInternal.hasConfiguredAuth(model.provider)
          ? this.setModel(model).then(() => true)
          : Promise.resolve(false),
      setSessionName: (name) => {
        this.setSessionName(name);
      },
      setThinkingLevel: (level) => this.setThinkingLevel(level),
    };
  }

  protected bindExtensionCore(runner: extensionsTypes.ExtensionRunner): void {
    runner.bindCore(this.coreActions(runner), this.contextActions(), this.providerActions());
  }

  protected buildRuntime(options: {
    activeToolNames?: string[] | undefined;
    flagValues?: Map<string, boolean | string>;
    includeAllExtensionTools?: boolean;
  }): void {
    this.resetMemory();
    this.resetBaseToolDefinitions();
    this.createExtensionRunner(options.flagValues);
    this.bindExtensionCore(this.extensionRunnerInternal);
    this.applyExtensionBindings(this.extensionRunnerInternal);
    if (this.baseToolsOverride === undefined) this.addExternalServiceTools();
    const defaultActiveToolNames =
      this.baseToolsOverride === undefined
        ? [...DEFAULT_TOOL_NAMES]
        : Object.keys(this.baseToolsOverride);
    this.refreshToolRegistry({
      activeToolNames: options.activeToolNames ?? defaultActiveToolNames,
      includeAllExtensionTools: options.includeAllExtensionTools,
    });
  }

  reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const oldRunner = this.extensionRunnerInternal;
        const previousFlagValues = oldRunner.getFlagValues();
        yield* awaited(
          emitSessionShutdownEvent(oldRunner, { reason: "reload", type: "session_shutdown" }),
        );
        oldRunner.invalidate();
        const getDefaultTools = () =>
          this.usesDefaultTools
            ? applyToolModifiers(
                this.settingsManager.getDefaultTools() ?? DEFAULT_TOOL_NAMES,
                this.defaultToolModifiers,
              )
            : [];
        const previousDefaultTools = new Set(getDefaultTools());
        yield* awaited(this.settingsManager.reload());
        this.syncQueueModesFromSettings();
        resetApiProviders();
        yield* awaited(this.resourceLoaderInternal.reload());
        const addedDefaultTools = getDefaultTools().filter(
          (name) => !previousDefaultTools.has(name),
        );
        for (const name of this.getActiveToolNames()) this.pendingToolNames.add(name);
        this.buildRuntime({
          activeToolNames: [...this.getActiveToolNames(), ...addedDefaultTools],
          flagValues: previousFlagValues,
          includeAllExtensionTools: true,
        });

        const hasBindings =
          this.extensionUIContext ||
          this.extensionCommandContextActions ||
          this.extensionShutdownHandler ||
          this.extensionErrorListener;
        if (hasBindings !== undefined) {
          yield* awaited(options?.beforeSessionStart?.());
          yield* awaited(
            this.extensionRunnerInternal.emit({ reason: "reload", type: "session_start" }),
          );
          this.extensionRunnerInternal.reportUnhandledMcpServers();
          yield* performed(this.extendResourcesFromExtensions("reload"));
        }
      }, this),
    );
  }

  createReplacedSessionContext(): extensionsTypes.ReplacedSessionContext {
    const context = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(this.extensionRunnerInternal.createCommandContext()),
    ) as extensionsTypes.ReplacedSessionContext;
    context.sendMessage = (message, options) => this.sendCustomMessage(message, options);
    context.sendUserMessage = (content, options) => this.sendUserMessage(content, options);
    return context;
  }
}
