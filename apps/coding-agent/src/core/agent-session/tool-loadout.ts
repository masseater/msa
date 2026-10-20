import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";

import errors from "../../utils/errors.ts";
import type agentSessionInternalTypes from "../agent-session-internal.types.ts";
import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import settingsManagerSupport from "../settings-manager-support.ts";
import type systemPromptTypes from "../system-prompt.types.ts";
const { getCurrentSystemMessage } = ai;
const { toErrorMessage } = errors;
const { applyToolModifiers } = settingsManagerSupport;

export default class SessionToolLoadout {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  initialActiveToolNames?: string[] | undefined;

  pendingToolNames = new Set<string>();

  hiddenDeclarations: ReadonlySet<string> = new Set();

  getActiveToolNames(): string[] {
    return this.session.tools.ask.askRun
      ? [...this.session.tools.ask.loadoutBeforeAsk]
      : this.declaredToolNames();
  }

  declaredToolNames(): string[] {
    return this.session.agent.state.tools.map((t) => t.name);
  }

  getCallableToolNames(): string[] {
    return this.getCallableTools().map((t) => t.name);
  }

  getCallableTools(
    active: ReadonlySet<string> = new Set(this.declaredToolNames()),
  ): agentTypes.AgentTool[] {
    return [...this.session.tools.registry.toolRegistry.values()].filter((tool) => {
      const exposure = this.session.tools.registry.getToolExposure(tool.name);
      return (
        exposure === "codemode" ||
        exposure === "deferred" ||
        (exposure === "direct" && active.has(tool.name))
      );
    });
  }

  setActiveToolsByName(toolNames: string[]): void {
    const previous = this.getActiveToolNames();
    this.setActiveTools(toolNames);
    const active = new Set(this.getActiveToolNames());
    if (previous.some((name) => !active.has(name))) this.pendingToolNames.clear();
  }

  setActiveTools(toolNames: string[]): void {
    const tools = this.applyToolLoadout(toolNames);
    for (const tool of tools) this.pendingToolNames.delete(tool.name);
    this.session.tools.prompt.rebuildSystemPrompt(tools.map((tool) => tool.name));
  }

  private runLoadoutHooks(
    tools: agentTypes.AgentTool[],
    hooks: agentSessionInternalTypes.ToolDefinitionEntry[],
  ) {
    const loadout: extensionsTypes.ToolLoadout = {
      callable: this.getCallableTools(new Set(tools.map((tool) => tool.name))),
      declared: tools,
      getExposure: (name) => this.session.tools.registry.getToolExposure(name),
      getNamespace: (name) =>
        this.session.tools.registry.toolDefinitions.get(name)?.definition.namespace,
      getPromptGuidelines: (name) => this.session.tools.prompt.toolPromptGuidelines.get(name) ?? [],
      registered: [...this.session.tools.registry.toolRegistry.values()],
    };
    const descriptions = new Map<string, string>();
    const hidden = new Set<string>();
    for (const { definition, sourceInfo } of hooks) {
      try {
        const changes = definition.prepareLoadout?.(loadout);
        for (const [name, description] of Object.entries(changes?.descriptions ?? {}))
          descriptions.set(name, description);
        for (const name of changes?.hiddenDeclarations ?? []) hidden.add(name);
      } catch (error) {
        this.session.extensions.binding.extensionRunnerInternal.emitError({
          error: toErrorMessage(error),
          event: "prepare_loadout",
          extensionPath: sourceInfo.path,
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }
    const declared = tools.map((tool) => {
      const description = descriptions.get(tool.name);
      return description === undefined ? tool : Object.assign({}, tool, { description });
    });
    return { declared, hidden };
  }

  private applyToolLoadout(toolNames: string[]): agentTypes.AgentTool[] {
    if (this.session.tools.ask.askRun)
      this.session.tools.ask.loadoutBeforeAsk = [...new Set(toolNames)];
    const tools = [...new Set(toolNames)].flatMap((name) => {
      const tool = this.session.tools.registry.toolRegistry.get(name);
      if (
        tool === undefined ||
        this.session.tools.registry.getToolExposure(name) === "hidden" ||
        !this.session.tools.policy.isActivatable(name)
      )
        return [];
      return this.session.tools.ask.askRun ? this.session.tools.ask.askTool(name, tool) : [tool];
    });
    const hooks = tools.flatMap((tool) => {
      const entry = this.session.tools.registry.toolDefinitions.get(tool.name);
      return entry?.definition.prepareLoadout === undefined ? [] : [entry];
    });
    const { declared, hidden } =
      hooks.length > 0
        ? this.runLoadoutHooks(tools, hooks)
        : { declared: tools, hidden: new Set<string>() };
    this.hiddenDeclarations = hidden;
    this.session.agent.state.tools = declared;
    return declared;
  }

  restoreToolsFromTranscript(modifiers: readonly string[] = []): void {
    this.pendingToolNames.clear();
    const current = getCurrentSystemMessage(
      this.session.sessionManager.buildSessionContext().messages,
    );
    if (current === undefined) return;
    const names = applyToolModifiers(
      (current.toolsAdded ?? []).map((tool) => tool.name),
      modifiers,
    );
    this.pendingToolNames = new Set(
      names.filter((name) => this.session.tools.policy.isAllowedTool(name)),
    );
    this.setActiveTools(names);
  }

  preparePromptAndToolLoadout(
    options: systemPromptTypes.NormalizedBuildSystemPromptOptions,
    messages: agentTypes.AgentMessage[] = this.session.agent.state.messages,
  ): compatTypes.SystemMessage | undefined {
    options.selectedTools = this.applyToolLoadout(options.selectedTools).map((tool) => tool.name);
    return this.session.tools.prompt.promptUpdate(options, messages);
  }

  configure(config: agentSessionTypes.AgentSessionConfig): void {
    this.initialActiveToolNames = config.initialActiveToolNames;
    this.session.tools.policy.applyToolPolicy(config);
  }
}
