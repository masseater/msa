import type { ModelRegistry } from "../model-registry.ts";
import type { SessionManager } from "../session-manager.ts";
import {
  applyContextActions,
  createBindings,
  idleCommandBindings,
  type RunnerBindings,
} from "./runner-bindings.ts";
import { ContextFactory } from "./runner-context.ts";
import { RunnerEmitApi } from "./runner-emit-api.ts";
import { type ProviderActions, ProviderBinder } from "./runner-providers.ts";
import type { ExtensionErrorListener } from "./runner-types.ts";
import { UIPromptTracker } from "./runner-ui-prompts.ts";
import { noOpUIContext } from "./runner-ui.ts";
import type {
  Extension,
  ExtensionActions,
  ExtensionCommandContext,
  ExtensionCommandContextActions,
  ExtensionContext,
  ExtensionContextActions,
  ExtensionError,
  ExtensionMode,
  ExtensionRuntime,
  ExtensionToolContext,
  ExtensionUIContext,
} from "./types.ts";

export { emitProjectTrustEvent, emitSessionShutdownEvent } from "./runner-events.ts";
export type {
  BeforeAgentStartTrigger,
  ExtensionErrorListener,
  ForkHandler,
  NavigateTreeHandler,
  NewSessionHandler,
  ReloadHandler,
  ShutdownHandler,
  SwitchSessionHandler,
} from "./runner-types.ts";

const STALE_MESSAGE =
  "This extension ctx is stale after session replacement or reload. Do not use a captured msa or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().";

export class ExtensionRunner extends RunnerEmitApi {
  private uiContext: ExtensionUIContext = noOpUIContext;
  private mode: ExtensionMode = "print";
  private readonly errorListeners = new Set<ExtensionErrorListener>();
  private readonly reportedMcpServers = new Set<string>();
  private staleMessage: string | undefined;
  private readonly bindings: RunnerBindings;
  private readonly contextFactory: ContextFactory;
  private readonly prompts: UIPromptTracker;

  constructor(
    extensions: Extension[],
    runtime: ExtensionRuntime,
    cwd: string,
    sessionManager: SessionManager,
    modelRegistry: ModelRegistry,
  ) {
    super(extensions, runtime, cwd, sessionManager, modelRegistry);
    this.bindings = createBindings(cwd);
    this.contextFactory = new ContextFactory({
      assertActive: () => this.assertActive(),
      ui: () => this.uiContext,
      mode: () => this.mode,
      hasUI: () => this.hasUI(),
      cwd,
      sessionManager,
      modelRegistry,
      runtime,
      bindings: this.bindings,
    });
    this.prompts = new UIPromptTracker((event) => {
      queueMicrotask(() => {
        void this.emit(event);
      });
    });
  }

  bindCore(
    actions: ExtensionActions,
    contextActions: ExtensionContextActions,
    providerActions?: ProviderActions,
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
    applyContextActions({ bindings: this.bindings, actions: contextActions, cwd: this.cwd });
    runtime.mcpServers.setChangeListener(() => {
      void this.emit({ type: "mcp_servers_change", servers: runtime.mcpServers.list() });
      this.reportUnhandledMcpServers();
    });
    new ProviderBinder(runtime, this.modelRegistry, providerActions, (error) =>
      this.emitError(error),
    ).bind();
  }

  bindCommandContext(actions?: ExtensionCommandContextActions): void {
    const next =
      actions === undefined
        ? idleCommandBindings()
        : {
            waitForIdleFn: actions.waitForIdle,
            newSessionHandler: actions.newSession,
            forkHandler: actions.fork,
            navigateTreeHandler: actions.navigateTree,
            switchSessionHandler: actions.switchSession,
            reloadHandler: actions.reload,
          };
    Object.assign(this.bindings, next);
  }

  setUIContext(uiContext?: ExtensionUIContext, mode: ExtensionMode = "print"): void {
    this.uiContext = uiContext === undefined ? noOpUIContext : this.prompts.wrap(uiContext);
    this.mode = mode;
  }

  getUIContext(): ExtensionUIContext {
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

  onError(listener: ExtensionErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  emitError(error: ExtensionError): void {
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
        extensionPath: server.extensionPath,
        event: "register_mcp_server",
        error: `MCP server "${server.name}" is registered, but no loaded extension connects MCP servers; another extension may have replaced the built-in MCP support`,
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

  createContext(): ExtensionContext {
    return this.contextFactory.createContext();
  }

  createToolContext(toolCallId: string, signal: AbortSignal | undefined): ExtensionToolContext {
    return this.contextFactory.createToolContext(toolCallId, signal);
  }

  createCommandContext(): ExtensionCommandContext {
    return this.contextFactory.createCommandContext();
  }

  protected assertActive(): void {
    if (this.staleMessage !== undefined && this.staleMessage !== "") {
      throw new Error(this.staleMessage);
    }
  }
}
