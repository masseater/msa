import AgentSessionLayer3 from "./agent-session-layer-3.ts";
import type cacheWarmerTypes from "./cache-warmer.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type memoryTypes from "./memory/memory.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import type orchestratorTypes from "./orchestrator/orchestrator.types.ts";
import type serviceTypes from "./pr-watch/service.types.ts";
import type promptTemplatesTypes from "./prompt-templates.types.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";
import systemPromptModule from "./system-prompt.ts";

const { buildSystemPrompt, normalizeBuildSystemPromptOptions } = systemPromptModule;

export default abstract class AgentSessionLayer4 extends AgentSessionLayer3 {
  get modelRuntime(): modelRuntimeTypes.ModelRuntime {
    return this.modelRuntimeInternal;
  }

  get cacheWarmingStatus(): cacheWarmerTypes.CacheWarmingStatus | undefined {
    return this.cacheWarmer?.status;
  }

  get systemPrompt(): string {
    return buildSystemPrompt(this.runSystemPromptOptions ?? this.baseSystemPromptOptions);
  }

  getAllTools(): extensionsTypes.ToolInfo[] {
    return Array.from(this.toolDefinitions.values()).map(({ definition, sourceInfo }) =>
      Object.assign(
        {
          description: definition.description,
          exposure: this.getToolExposure(definition.name),
          name: definition.name,
          parameters: definition.parameters,
          promptGuidelines: definition.promptGuidelines,
          sourceInfo,
        },
        definition.namespace === undefined ? {} : { namespace: definition.namespace },
        definition.annotations === undefined
          ? {}
          : { annotations: Object.assign({}, definition.annotations) },
        definition.reachesTools === undefined ? {} : { reachesTools: definition.reachesTools },
      ),
    );
  }

  getToolDefinition(name: string): extensionsTypes.ToolDefinition | undefined {
    return this.toolDefinitions.get(name)?.definition;
  }

  protected getToolExposure(name: string): extensionsTypes.ToolExposure {
    return this.toolDefinitions.get(name)?.definition.exposure ?? "direct";
  }

  get promptTemplates(): ReadonlyArray<promptTemplatesTypes.PromptTemplate> {
    return this.resourceLoaderInternal.getPrompts().prompts;
  }

  protected rebuildSystemPrompt(toolNames: string[]): void {
    const validToolNames = toolNames.filter((name) => this.toolRegistry.has(name));
    const toolSnippets: Record<string, string> = {};
    for (const name of this.toolRegistry.keys()) {
      const snippet = this.toolPromptSnippets.get(name);
      if (snippet !== undefined && snippet !== "") toolSnippets[name] = snippet;
    }

    const loaderSystemPrompt = this.resourceLoaderInternal.getSystemPrompt();
    const loaderAppendSystemPrompt = this.resourceLoaderInternal.getAppendSystemPrompt();
    const appendSystemPrompt =
      loaderAppendSystemPrompt.length > 0 ? loaderAppendSystemPrompt.join("\n\n") : "";
    const loadedSkills = this.resourceLoaderInternal.getSkills().skills;
    const loadedContextFiles = this.resourceLoaderInternal.getAgentsFiles().agentsFiles;

    this.baseSystemPromptOptions = normalizeBuildSystemPromptOptions({
      appendSystemPrompt,
      contextFiles: loadedContextFiles,
      customPrompt: loaderSystemPrompt,
      cwd: this.cwd,
      hiddenTools: [...this.hiddenDeclarations],
      selectedTools: validToolNames,
      skills: loadedSkills,
      toolGuidelines: Object.fromEntries(this.toolPromptGuidelines),
      toolSnippets,
    });
  }

  get resourceLoader(): resourceLoaderTypes.ResourceLoader {
    return this.resourceLoaderInternal;
  }

  get orchestrator(): orchestratorTypes.Orchestrator | undefined {
    return this.orchestratorInternal;
  }

  get memory(): memoryTypes.MemoryService | undefined {
    return this.memoryInternal;
  }

  get prWatch(): serviceTypes.PrWatchSnapshot {
    return this.prWatchInternal.snapshot();
  }

  protected applyExtensionBindings(runner: extensionsTypes.ExtensionRunner): void {
    runner.setUIContext(this.extensionUIContext, this.extensionMode);
    runner.bindCommandContext(this.extensionCommandContextActions);

    this.extensionErrorUnsubscriber?.();
    this.extensionErrorUnsubscriber =
      this.extensionErrorListener === undefined
        ? undefined
        : runner.onError(this.extensionErrorListener);
  }

  protected refreshCurrentModelFromRegistry(): void {
    const currentModel = this.model;
    if (currentModel === undefined) {
      return;
    }

    const refreshedModel = this.modelRuntimeInternal.getModel(
      currentModel.provider,
      currentModel.id,
    );
    if (refreshedModel === undefined || refreshedModel === currentModel) {
      return;
    }

    this.agent.state.model = refreshedModel;
  }

  protected providerActions(): Parameters<extensionsTypes.ExtensionRunner["bindCore"]>[2] {
    const thenRefresh =
      <A extends unknown[]>(change: (...args: A) => void) =>
      (...args: A) => {
        change(...args);
        this.refreshCurrentModelFromRegistry();
      };
    const runtime = this.modelRuntimeInternal;
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

  protected isDeclarable(name: string): boolean {
    const exposure = this.getToolExposure(name);
    return exposure === "direct" || exposure === "model-only";
  }

  protected isActivatedOnRegistration(name: string): boolean {
    return (
      this.isDeclarable(name) && this.toolDefinitions.get(name)?.definition.defaultActive !== false
    );
  }

  get extensionRunner(): extensionsTypes.ExtensionRunner {
    return this.extensionRunnerInternal;
  }
}
