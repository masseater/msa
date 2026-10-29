import type modelRegistryTypes from "../model-registry.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import runnerBindings from "./runner-bindings.ts";
import runnerParts from "./runner-parts.ts";
import type runnerPartsTypes from "./runner-parts.types.ts";
import ProviderBinder from "./runner-providers.ts";
import type runnerTypesTypes from "./runner-types.ts";
import runnerUi from "./runner-ui.ts";
import type extensionsTypesTypes from "./types.types.ts";

type Parts = runnerPartsTypes.RunnerParts;
type Queries = Parts["queries"];
type Events = Parts["events"];

const { noOpUIContext } = runnerUi;
const { applyCommandActions, applyContextActions, applyRuntimeActions, createBindings } =
  runnerBindings;
const { createRunnerParts } = runnerParts;

const STALE_MESSAGE =
  "This extension ctx is stale after session replacement or reload. Do not use a captured msa or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().";
export default class ExtensionRunner {
  private readonly runtime: extensionsTypesTypes.ExtensionRuntime;
  private readonly cwd: string;
  private readonly modelRegistry: modelRegistryTypes.ModelRegistry;
  private readonly bindings: ReturnType<typeof createBindings>;
  private readonly parts: Parts;
  private uiContext: extensionsTypesTypes.ExtensionUIContext = noOpUIContext;
  private mode: extensionsTypesTypes.ExtensionMode = "print";
  private staleMessage: string | undefined;

  constructor(
    extensions: extensionsTypesTypes.Extension[],
    runtime: extensionsTypesTypes.ExtensionRuntime,
    cwd: string,
    sessionManager: sessionManagerTypes.SessionManager,
    modelRegistry: modelRegistryTypes.ModelRegistry,
  ) {
    this.runtime = runtime;
    this.cwd = cwd;
    this.modelRegistry = modelRegistry;
    this.bindings = createBindings(cwd);
    const assertActive = () => this.assertActive();
    const hasUI = () => this.hasUI();
    this.parts = createRunnerParts({
      context: {
        assertActive,
        bindings: this.bindings,
        cwd,
        hasUI,
        mode: () => this.mode,
        modelRegistry,
        runtime,
        sessionManager,
        ui: () => this.uiContext,
      },
      events: {
        assertActive,
        createContext: () => this.createContext(),
        emitError: (error) => this.emitError(error),
        extensions,
      },
      onPromptEvent: (event) => {
        queueMicrotask(() => {
          void this.emit(event);
        });
      },
      queries: { extensions, hasUI, modelRegistry, runtime },
    });
  }

  bindCore(
    actions: extensionsTypesTypes.ExtensionActions,
    contextActions: extensionsTypesTypes.ExtensionContextActions,
    providerActions?: ConstructorParameters<typeof ProviderBinder>[2],
  ): void {
    const { runtime } = this;
    applyRuntimeActions(runtime, actions);
    runtime.createContext = () => this.createContext();
    applyContextActions({ actions: contextActions, bindings: this.bindings, cwd: this.cwd });
    runtime.mcpServers.setChangeListener(() => {
      void this.emit({ servers: runtime.mcpServers.list(), type: "mcp_servers_change" });
      this.reportUnhandledMcpServers();
    });
    runtime.mcpServers.setIgnoreListener((error, extensionPath) => {
      this.emitError({ error, event: "register_mcp_server", extensionPath });
    });
    new ProviderBinder(runtime, this.modelRegistry, providerActions, (error) =>
      this.emitError(error),
    ).bind();
  }

  bindCommandContext(actions?: extensionsTypesTypes.ExtensionCommandContextActions): void {
    applyCommandActions(this.bindings, actions);
  }

  setUIContext(
    uiContext?: extensionsTypesTypes.ExtensionUIContext,
    mode: extensionsTypesTypes.ExtensionMode = "print",
  ): void {
    this.uiContext = uiContext === undefined ? noOpUIContext : this.parts.prompts.wrap(uiContext);
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
    return this.parts.errors.onError(listener);
  }

  emitError(error: extensionsTypesTypes.ExtensionError): void {
    this.parts.errors.emit(error);
  }

  reportUnhandledMcpServers(): void {
    if (!this.hasHandlers("mcp_servers_change"))
      this.parts.errors.reportUnhandledMcpServers(this.runtime.mcpServers.list());
  }

  shutdown(): void {
    this.bindings.shutdownHandler();
  }

  getActiveTools(): string[] {
    this.assertActive();
    return this.runtime.getActiveTools();
  }

  createContext(): extensionsTypesTypes.ExtensionContext {
    return this.parts.contextFactory.createContext();
  }

  createToolContext(
    toolCallId: string,
    signal: AbortSignal | undefined,
  ): extensionsTypesTypes.ExtensionToolContext {
    return this.parts.contextFactory.createToolContext(toolCallId, signal);
  }

  createCommandContext(): extensionsTypesTypes.ExtensionCommandContext {
    return this.parts.contextFactory.createCommandContext();
  }

  private assertActive(): void {
    if (this.staleMessage !== undefined && this.staleMessage !== "") {
      throw new Error(this.staleMessage);
    }
  }

  getExtensionPaths() {
    return this.parts.queries.getExtensionPaths();
  }

  getAllRegisteredTools() {
    return this.parts.queries.getAllRegisteredTools();
  }

  getToolDefinition(toolName: string) {
    return this.parts.queries.getToolDefinition(toolName);
  }

  getFlags() {
    return this.parts.queries.getFlags();
  }

  setFlagValue(name: string, value: boolean | string): void {
    this.parts.queries.setFlagValue(name, value);
  }

  getFlagValues() {
    return this.parts.queries.getFlagValues();
  }

  getShortcuts(...args: Parameters<Queries["getShortcuts"]>) {
    return this.parts.queries.getShortcuts(...args);
  }

  getShortcutDiagnostics() {
    return this.parts.queries.getShortcutDiagnostics();
  }

  hasHandlers(eventType: string): boolean {
    return this.parts.queries.hasHandlers(eventType);
  }

  getMessageRenderer(customType: string) {
    return this.parts.queries.getMessageRenderer(customType);
  }

  getExternalServices() {
    return this.parts.queries.getExternalServices();
  }

  getMarkdownTransformers() {
    return this.parts.queries.getMarkdownTransformers();
  }

  resolveToolRenderers(
    toolName: string,
    base: () => extensionsTypesTypes.ToolRenderers | undefined,
  ): extensionsTypesTypes.ToolRenderers | undefined {
    return this.parts.queries.resolveToolRenderers(toolName, base);
  }

  getEntryRenderer(customType: string) {
    return this.parts.queries.getEntryRenderer(customType);
  }

  getModelRegistry(): modelRegistryTypes.ModelRegistry {
    return this.modelRegistry;
  }

  getRegisteredCommands() {
    return this.parts.queries.getRegisteredCommands();
  }

  getCommandDiagnostics() {
    return this.parts.queries.getCommandDiagnostics();
  }

  getCommand(name: string) {
    return this.parts.queries.getCommand(name);
  }

  emitBoundary(...args: Parameters<Events["emitBoundary"]>) {
    return this.parts.events.emitBoundary(...args);
  }

  emit<TEvent extends runnerTypesTypes.RunnerEmitEvent>(event: TEvent) {
    return this.parts.events.emit(event);
  }

  emitCacheWarmingDecision(event: extensionsTypesTypes.CacheWarmingDecisionEvent) {
    return this.parts.events.emitCacheWarmingDecision(event);
  }

  emitMessageEnd(event: extensionsTypesTypes.MessageEndEvent) {
    return this.parts.events.emitMessageEnd(event);
  }

  emitToolResult(event: extensionsTypesTypes.ToolResultEvent) {
    return this.parts.events.emitToolResult(event);
  }

  emitToolCall(event: extensionsTypesTypes.ToolCallEvent) {
    return this.parts.events.emitToolCall(event);
  }

  emitUserBash(event: extensionsTypesTypes.UserBashEvent) {
    return this.parts.events.emitUserBash(event);
  }

  emitContext(...args: Parameters<Events["emitContext"]>) {
    return this.parts.events.emitContext(...args);
  }

  emitBeforeProviderRequest(payload: unknown) {
    return this.parts.events.emitBeforeProviderRequest(payload);
  }

  emitBeforeProviderHeaders(...args: Parameters<Events["emitBeforeProviderHeaders"]>) {
    return this.parts.events.emitBeforeProviderHeaders(...args);
  }

  emitBeforeAgentStart(...args: Parameters<Events["emitBeforeAgentStart"]>) {
    return this.parts.events.emitBeforeAgentStart(...args);
  }

  emitResourcesDiscover(...args: Parameters<Events["emitResourcesDiscover"]>) {
    return this.parts.events.emitResourcesDiscover(...args);
  }

  emitInput(...args: Parameters<Events["emitInput"]>) {
    return this.parts.events.emitInput(...args);
  }
}
