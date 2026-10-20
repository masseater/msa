import type modelRegistryTypes from "../model-registry.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import runnerBindings from "./runner-bindings.ts";
import type runnerBindingsTypes from "./runner-bindings.types.ts";
import ContextFactory from "./runner-context.ts";
import type runnerContextTypes from "./runner-context.types.ts";
import RunnerEmitApi from "./runner-emit-api.ts";
import ProviderBinder from "./runner-providers.ts";
import type runnerProvidersTypes from "./runner-providers.types.ts";
import type runnerTypesTypes from "./runner-types.ts";
import UIPromptTracker from "./runner-ui-prompts.ts";
import type runnerUiPromptsTypes from "./runner-ui-prompts.types.ts";
import runnerUi from "./runner-ui.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { noOpUIContext } = runnerUi;
const { applyContextActions, createBindings, idleCommandBindings } = runnerBindings;

const STALE_MESSAGE =
  "This extension ctx is stale after session replacement or reload. Do not use a captured msa or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().";
export default class ExtensionRunner extends RunnerEmitApi {
  private uiContext: extensionsTypesTypes.ExtensionUIContext = noOpUIContext;
  private mode: extensionsTypesTypes.ExtensionMode = "print";
  private readonly errorListeners = new Set<runnerTypesTypes.ExtensionErrorListener>();
  private readonly reportedMcpServers = new Set<string>();
  private staleMessage: string | undefined;
  private readonly bindings: runnerBindingsTypes.RunnerBindings;
  private readonly contextFactory: runnerContextTypes.ContextFactory;
  private readonly prompts: runnerUiPromptsTypes.UIPromptTracker;

  constructor(
    extensions: extensionsTypesTypes.Extension[],
    runtime: extensionsTypesTypes.ExtensionRuntime,
    cwd: string,
    sessionManager: sessionManagerTypes.SessionManager,
    modelRegistry: modelRegistryTypes.ModelRegistry,
  ) {
    super(extensions, runtime, cwd, sessionManager, modelRegistry);
    this.bindings = createBindings(cwd);
    this.contextFactory = new ContextFactory({
      assertActive: () => this.assertActive(),
      bindings: this.bindings,
      cwd,
      hasUI: () => this.hasUI(),
      mode: () => this.mode,
      modelRegistry,
      runtime,
      sessionManager,
      ui: () => this.uiContext,
    });
    this.prompts = new UIPromptTracker((event) => {
      queueMicrotask(() => {
        void this.emit(event);
      });
    });
  }

  bindCore(
    actions: extensionsTypesTypes.ExtensionActions,
    contextActions: extensionsTypesTypes.ExtensionContextActions,
    providerActions?: runnerProvidersTypes.ProviderActions,
  ): void {
    const { runtime } = this;
    runtime.sendMessage = actions.sendMessage;
    runtime.sendUserMessage = actions.sendUserMessage;
    runtime.appendEntry = actions.appendEntry;
    runtime.setSessionName = actions.setSessionName;
    runtime.getSessionName = actions.getSessionName;
    runtime.setLabel = actions.setLabel;
    runtime.getActiveTools = actions.getActiveTools;
    runtime.getAllTools = actions.getAllTools;
    runtime.getSettings = actions.getSettings;
    runtime.setActiveTools = actions.setActiveTools;
    runtime.refreshTools = actions.refreshTools;
    runtime.getCommands = actions.getCommands;
    runtime.setModel = actions.setModel;
    runtime.getThinkingLevel = actions.getThinkingLevel;
    runtime.setThinkingLevel = actions.setThinkingLevel;
    runtime.createContext = () => this.createContext();
    applyContextActions({ actions: contextActions, bindings: this.bindings, cwd: this.cwd });
    runtime.mcpServers.setChangeListener(() => {
      void this.emit({ servers: runtime.mcpServers.list(), type: "mcp_servers_change" });
      this.reportUnhandledMcpServers();
    });
    new ProviderBinder(runtime, this.modelRegistry, providerActions, (error) =>
      this.emitError(error),
    ).bind();
  }

  bindCommandContext(actions?: extensionsTypesTypes.ExtensionCommandContextActions): void {
    const next =
      actions === undefined
        ? idleCommandBindings()
        : {
            forkHandler: actions.fork,
            navigateTreeHandler: actions.navigateTree,
            newSessionHandler: actions.newSession,
            reloadHandler: actions.reload,
            switchSessionHandler: actions.switchSession,
            waitForIdleFn: actions.waitForIdle,
          };
    Object.assign(this.bindings, next);
  }

  setUIContext(
    uiContext?: extensionsTypesTypes.ExtensionUIContext,
    mode: extensionsTypesTypes.ExtensionMode = "print",
  ): void {
    this.uiContext = uiContext === undefined ? noOpUIContext : this.prompts.wrap(uiContext);
    this.mode = mode;
  }

  getUIContext(): extensionsTypesTypes.ExtensionUIContext {
    return this.uiContext;
  }

  hasUI(): boolean {
    return this.uiContext !== noOpUIContext;
  }

  invalidate(message = STALE_MESSAGE): void {
    if (this.staleMessage === undefined || this.staleMessage === "") {
      this.staleMessage = message;
      this.runtime.invalidate(message);
    }
  }

  onError(listener: runnerTypesTypes.ExtensionErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  emitError(error: extensionsTypesTypes.ExtensionError): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  reportUnhandledMcpServers(): void {
    if (this.hasHandlers("mcp_servers_change")) return;
    for (const server of this.runtime.mcpServers.list()) {
      if (this.reportedMcpServers.has(server.name)) continue;
      this.reportedMcpServers.add(server.name);
      this.emitError({
        error: `MCP server "${server.name}" is registered, but no loaded extension connects MCP servers; another extension may have replaced the built-in MCP support`,
        event: "register_mcp_server",
        extensionPath: server.extensionPath,
      });
    }
  }

  shutdown(): void {
    this.bindings.shutdownHandler();
  }

  getActiveTools(): string[] {
    this.assertActive();
    return this.runtime.getActiveTools();
  }

  createContext(): extensionsTypesTypes.ExtensionContext {
    return this.contextFactory.createContext();
  }

  createToolContext(
    toolCallId: string,
    signal: AbortSignal | undefined,
  ): extensionsTypesTypes.ExtensionToolContext {
    return this.contextFactory.createToolContext(toolCallId, signal);
  }

  createCommandContext(): extensionsTypesTypes.ExtensionCommandContext {
    return this.contextFactory.createCommandContext();
  }

  protected assertActive(): void {
    if (this.staleMessage !== undefined && this.staleMessage !== "") {
      throw new Error(this.staleMessage);
    }
  }
}
