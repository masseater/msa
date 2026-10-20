import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type agentSessionInternalTypes from "./agent-session-internal.types.ts";
import AgentSessionLayer9 from "./agent-session-layer-9.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import authGuidance from "./auth-guidance.ts";
import extensionsModule from "./extensions/index.ts";
import ModelRegistry from "./model-registry.ts";
import type orchestratorTypes from "./orchestrator/orchestrator.types.ts";
import usageTotalsModule from "./usage-totals.ts";

const { addUsageToTotals, combineUsage, createUsageTotals } = usageTotalsModule;
const { formatNoModelSelectedMessage } = authGuidance;
const { ExtensionRunner, wrapRegisteredTools } = extensionsModule;

export default abstract class AgentSessionLayer10 extends AgentSessionLayer9 {
  protected attachNestedCalls(event: agentTypes.AgentEvent): void {
    if (this.nestedToolCalls === undefined) return;
    if (event.type === "agent_end") {
      this.nestedToolCalls.clear();
      return;
    }
    if (event.type !== "message_start" || event.message.role !== "toolResult") return;
    const message = event.message;
    const summary = this.nestedToolCalls.takeRecord(message.toolCallId);
    if (summary?.calls !== undefined) message.nestedCalls = summary.calls;
    if (summary?.usage !== undefined) {
      message.usage =
        message.usage === undefined ? summary.usage : combineUsage(message.usage, summary.usage);
    }
  }

  protected orchestratorDefaults(): orchestratorTypes.OrchestratorDefaults {
    const current = this.model;
    if (current === undefined) throw new Error(formatNoModelSelectedMessage());
    const currentReference = `${current.provider}/${current.id}`;
    return {
      maxConcurrentThreads: this.settingsManager.getOrchestratorMaxConcurrentThreads(),
      reviewModel: this.settingsManager.getOrchestratorReviewModel() ?? currentReference,
      reviewThinkingLevel:
        this.settingsManager.getOrchestratorReviewThinkingLevel() ?? this.thinkingLevel,
      workerModel: this.settingsManager.getOrchestratorWorkerModel() ?? currentReference,
      workerThinkingLevel:
        this.settingsManager.getOrchestratorWorkerThinkingLevel() ?? this.thinkingLevel,
    };
  }

  setThinkingLevel(
    level: agentTypes.ThinkingLevel,
    options: agentSessionTypes.ModelMutationOptions = {},
  ): void {
    const availableLevels = this.getAvailableThinkingLevels();
    const effectiveLevel = availableLevels.includes(level)
      ? level
      : this.clampThinkingLevel(level, availableLevels);

    const previousLevel = this.agent.state.thinkingLevel;
    const isChanging = effectiveLevel !== previousLevel;

    this.agent.state.thinkingLevel = effectiveLevel;

    if (options.persist === true) {
      this.settingsManager.setDefaultThinkingLevel(level);
    }

    if (isChanging) {
      this.sessionManager.appendThinkingLevelChange(effectiveLevel);
      this.emit({ level: effectiveLevel, type: "thinking_level_changed" });
      void this.extensionRunnerInternal.emit({
        level: effectiveLevel,
        previousLevel,
        type: "thinking_level_select",
      });
    }
  }

  cycleThinkingLevel(
    options: agentSessionTypes.ModelMutationOptions = {},
  ): agentTypes.ThinkingLevel | undefined {
    if (!this.supportsThinking()) return undefined;

    const levels = this.getAvailableThinkingLevels();
    const currentIndex = levels.indexOf(this.thinkingLevel);
    const nextIndex = (currentIndex + 1) % levels.length;
    const nextLevel = levels[nextIndex];
    if (nextLevel === undefined) return undefined;

    this.setThinkingLevel(nextLevel, options);
    return nextLevel;
  }

  protected wrapToolRegistry(
    allCustomTools: agentSessionInternalTypes.ToolDefinitionEntry[],
    definitionRegistry: Map<string, agentSessionInternalTypes.ToolDefinitionEntry>,
  ): agentTypes.AgentTool[] {
    const runner = this.extensionRunnerInternal;
    const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, runner);
    const wrappedBuiltInTools = wrapRegisteredTools(
      Array.from(this.baseToolDefinitions.values())
        .filter((definition) => this.isAllowedTool(definition.name))
        .map((definition) => this.builtinToolEntry(definition.name, definition)),
      runner,
    );
    const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
    for (const tool of wrappedExtensionTools as agentTypes.AgentTool[])
      toolRegistry.set(tool.name, tool);
    this.toolRegistry = toolRegistry;
    this.askVariants = new Map(
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

  protected createExtensionRunner(flagValues: Map<string, boolean | string> | undefined): void {
    const extensionsResult = this.resourceLoaderInternal.getExtensions();
    for (const [name, value] of flagValues ?? [])
      extensionsResult.runtime.flagValues.set(name, value);
    this.extensionRunnerInternal = new ExtensionRunner(
      extensionsResult.extensions,
      extensionsResult.runtime,
      this.cwd,
      this.sessionManager,
      new ModelRegistry(this.modelRuntimeInternal),
    );
    if (this.extensionRunnerRef !== undefined)
      this.extensionRunnerRef.current = this.extensionRunnerInternal;
  }

  protected countSessionEntries() {
    const counts = {
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      userMessages: 0,
    };
    const usageTotals = createUsageTotals();
    for (const entry of this.sessionManager.getEntries()) {
      if (entry.type === "usage") addUsageToTotals(usageTotals, entry.usage);
      else if (
        (entry.type === "branch_summary" || entry.type === "compaction") &&
        entry.usage !== undefined
      )
        addUsageToTotals(usageTotals, entry.usage);
      if (entry.type !== "message") continue;
      counts.totalMessages++;
      const message = entry.message;
      if (message.role === "user") counts.userMessages++;
      else if (message.role === "toolResult") {
        counts.toolResults++;
        if (message.usage !== undefined) addUsageToTotals(usageTotals, message.usage);
      } else if (message.role === "assistant") {
        counts.assistantMessages++;
        const assistantMsg = message as compatTypes.AssistantMessage;
        if (Array.isArray(assistantMsg.content))
          counts.toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
        addUsageToTotals(usageTotals, assistantMsg.usage);
      }
    }
    return { counts, usageTotals };
  }
}
