import type agentTypes from "@msa/agent-core/index.types";

import type agentSessionInternalTypes from "../agent-session-internal.types.ts";
import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import extensionsModule from "../extensions/index.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import sourceInfoModule from "../source-info.ts";
import baseToolDefinitions from "./base-tool-definitions.ts";

const { BUILTIN_PATH_PREFIX, createSyntheticSourceInfo } = sourceInfoModule;
const { wrapRegisteredTools } = extensionsModule;
const { createBaseToolDefinitions } = baseToolDefinitions;

export default class SessionToolRegistry {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  customTools!: extensionsTypes.ToolDefinition[];

  private baseToolDefinitions: Map<string, extensionsTypes.ToolDefinition> = new Map();

  baseToolsOverride?: Record<string, agentTypes.AgentTool> | undefined;

  toolRegistry: Map<string, agentTypes.AgentTool> = new Map();

  toolDefinitions: Map<string, agentSessionInternalTypes.ToolDefinitionEntry> = new Map();

  getAllTools(): extensionsTypes.ToolInfo[] {
    return Array.from(this.toolDefinitions.values(), ({ definition, sourceInfo }) => ({
      description: definition.description,
      exposure: this.getToolExposure(definition.name),
      name: definition.name,
      parameters: definition.parameters,
      promptGuidelines: definition.promptGuidelines,
      sourceInfo,
      ...(definition.namespace === undefined ? {} : { namespace: definition.namespace }),
      ...(definition.annotations === undefined
        ? {}
        : { annotations: { ...definition.annotations } }),
      ...(definition.reachesTools === undefined ? {} : { reachesTools: definition.reachesTools }),
    }));
  }

  getToolDefinition(name: string): extensionsTypes.ToolDefinition | undefined {
    return this.toolDefinitions.get(name)?.definition;
  }

  getToolExposure(name: string): extensionsTypes.ToolExposure {
    return this.toolDefinitions.get(name)?.definition.exposure ?? "direct";
  }

  private isDeclarable(name: string): boolean {
    const exposure = this.getToolExposure(name);
    return exposure === "direct" || exposure === "model-only";
  }

  private isActivatedOnRegistration(name: string): boolean {
    return (
      this.isDeclarable(name) && this.toolDefinitions.get(name)?.definition.defaultActive !== false
    );
  }

  private registrationActivations(
    options:
      | { activeToolNames?: string[]; includeAllExtensionTools?: boolean | undefined }
      | undefined,
    previousActivatedOnRegistration: ReadonlySet<string>,
    wrappedExtensionTools: agentTypes.AgentTool[],
  ): string[] {
    const allowedTools = this.session.tools.policy.allowedTools;
    if (allowedTools !== undefined)
      return [...this.toolRegistry.keys()].filter(
        (toolName) => allowedTools(toolName) && this.isDeclarable(toolName),
      );
    if (options?.includeAllExtensionTools === true)
      return wrappedExtensionTools
        .filter((tool) => this.isActivatedOnRegistration(tool.name))
        .map((tool) => tool.name);
    if (options?.activeToolNames !== undefined) return [];
    return [...this.toolRegistry.keys()].filter(
      (toolName) =>
        !previousActivatedOnRegistration.has(toolName) && this.isActivatedOnRegistration(toolName),
    );
  }

  private builtinToolEntry(name: string, definition: extensionsTypes.ToolDefinition) {
    return {
      definition,
      sourceInfo: createSyntheticSourceInfo(`${BUILTIN_PATH_PREFIX}${name}`, { source: "builtin" }),
    };
  }

  private collectToolDefinitions() {
    const allCustomTools = [
      ...this.session.extensions.binding.extensionRunnerInternal.getAllRegisteredTools(),
      ...this.customTools.map((definition) => ({
        definition,
        sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, { source: "sdk" }),
      })),
    ].filter((tool) => this.session.tools.policy.isAllowedTool(tool.definition.name));
    const definitionRegistry = new Map<string, agentSessionInternalTypes.ToolDefinitionEntry>(
      Array.from(this.baseToolDefinitions.entries())
        .filter(([name]) => this.session.tools.policy.isAllowedTool(name))
        .map(([name, definition]) => [name, this.builtinToolEntry(name, definition)]),
    );
    for (const tool of allCustomTools) {
      definitionRegistry.set(tool.definition.name, {
        definition: tool.definition,
        sourceInfo: tool.sourceInfo,
      });
    }
    return { allCustomTools, definitionRegistry };
  }

  addBaseToolDefinition(definition: extensionsTypes.ToolDefinition): void {
    this.baseToolDefinitions.set(definition.name, definition);
  }

  private wrapToolRegistry(
    allCustomTools: agentSessionInternalTypes.ToolDefinitionEntry[],
    definitionRegistry: Map<string, agentSessionInternalTypes.ToolDefinitionEntry>,
  ): agentTypes.AgentTool[] {
    const runner = this.session.extensions.binding.extensionRunnerInternal;
    const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, runner);
    const wrappedBuiltInTools = wrapRegisteredTools(
      Array.from(this.baseToolDefinitions.values())
        .filter((definition) => this.session.tools.policy.isAllowedTool(definition.name))
        .map((definition) => this.builtinToolEntry(definition.name, definition)),
      runner,
    );
    const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
    for (const tool of wrappedExtensionTools as agentTypes.AgentTool[])
      toolRegistry.set(tool.name, tool);
    this.toolRegistry = toolRegistry;
    this.session.tools.ask.askVariants = new Map(
      Array.from(definitionRegistry.values()).flatMap(({ definition, sourceInfo }) => {
        const variant = definition.readOnlyVariant;
        if (variant === undefined || variant.annotations?.readOnlyHint !== true) return [];
        const [tool] = wrapRegisteredTools([{ definition: variant, sourceInfo }], runner);
        return tool === undefined
          ? []
          : [[definition.name, { definition: variant, tool }] as const];
      }),
    );
    return wrappedExtensionTools as agentTypes.AgentTool[];
  }

  refreshToolRegistry(options?: {
    activeToolNames?: string[];
    includeAllExtensionTools?: boolean | undefined;
  }): void {
    const previousActivatedOnRegistration = new Set(
      [...this.toolRegistry.keys()].filter((name) => this.isActivatedOnRegistration(name)),
    );
    const previousActiveToolNames = this.session.tools.loadout.getActiveToolNames();
    const { allCustomTools, definitionRegistry } = this.collectToolDefinitions();
    this.toolDefinitions = definitionRegistry;
    this.session.tools.prompt.indexToolPrompts(definitionRegistry);
    const wrappedExtensionTools = this.wrapToolRegistry(allCustomTools, definitionRegistry);
    const nextActiveToolNames = [
      ...(options?.activeToolNames ?? previousActiveToolNames).filter((name) =>
        this.session.tools.policy.isAllowedTool(name),
      ),
      ...this.registrationActivations(
        options,
        previousActivatedOnRegistration,
        wrappedExtensionTools,
      ),
      ...this.session.tools.loadout.pendingToolNames,
    ];
    this.session.tools.loadout.setActiveTools([...new Set(nextActiveToolNames)]);
  }

  resetBaseToolDefinitions(): void {
    this.baseToolDefinitions = createBaseToolDefinitions(this.session);
  }

  configure(config: agentSessionTypes.AgentSessionConfig): void {
    this.customTools = config.customTools ?? [];
    this.baseToolsOverride = config.baseToolsOverride;
  }
}
