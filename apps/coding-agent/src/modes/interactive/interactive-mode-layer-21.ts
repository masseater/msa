import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";

import type extensionsTypes from "../../core/extensions/index.types.ts";
import modelResolver from "../../core/model-resolver.ts";
import orchestratorSupport from "../../core/orchestrator/orchestrator-support.ts";
import CustomMessageComponent from "./components/custom-message.ts";
import tasksViewHelpers from "./components/tasks-view-helpers.ts";
import InteractiveModeLayer20 from "./interactive-mode-layer-20.ts";

const { ORCHESTRATOR_REPORT_MESSAGE_TYPE } = orchestratorSupport;
const { createTaskReportRenderer } = tasksViewHelpers;
const { resolveModelScopeFromModels } = modelResolver;

export default abstract class InteractiveModeLayer21 extends InteractiveModeLayer20 {
  protected onMessageUpdate(message: agentTypes.AgentMessage): void {
    if (this.streamingComponent === undefined || message.role !== "assistant") return;
    this.streamingMessage = message;
    this.streamingComponent.updateContent(this.streamingMessage, true);
    for (const content of this.streamingMessage.content) {
      if (content.type !== "toolCall") continue;
      const existing = this.pendingTools.get(content.id);
      if (existing === undefined)
        this.createToolComponent(content.name, content.id, content.arguments);
      else existing.updateArgs(content.arguments);
    }
    this.ui.requestRender();
  }

  protected addCustomMessageToChat(
    message: Extract<agentTypes.AgentMessage, { role: "custom" }>,
  ): void {
    if (!message.display) return;
    const renderer =
      message.customType === ORCHESTRATOR_REPORT_MESSAGE_TYPE
        ? (createTaskReportRenderer(this.session.orchestrator) as extensionsTypes.MessageRenderer)
        : this.session.extensionRunner.getMessageRenderer(message.customType);
    const component = new CustomMessageComponent(
      message,
      renderer,
      this.getMarkdownThemeWithSettings(),
      this.outputPad,
    );
    component.setExpanded(this.toolOutputExpanded);
    this.chatContainer.addChild(component);
  }

  protected showModelsSelectorCurrentEnabledIds(): {
    currentEnabledIds: string[] | null;
    availableModelIds: Set<string>;
    availableModels: compatTypes.Model<aiTypes.Api>[];
    selectionChanged: boolean;
    sessionScopedModels: readonly {
      model: compatTypes.Model<any>;
      thinkingLevel?: agentTypes.ThinkingLevel | undefined;
    }[];
    configuredEnabledIds: (models: readonly compatTypes.Model<any>[]) => string[] | null;
  } {
    let availableModels = [...this.session.modelRuntime.getAvailableSnapshot()];
    let availableModelIds = new Set(
      availableModels.map((model) => `${model.provider}/${model.id}`),
    );
    const configuredPatterns = this.settingsManager.getEnabledModels();
    const sessionScopedModels = this.session.scopedModels;
    const configuredEnabledIds = (models: readonly compatTypes.Model<any>[]): string[] | null => {
      if (configuredPatterns?.length === undefined || configuredPatterns?.length === 0) return null;
      const resolved = resolveModelScopeFromModels(configuredPatterns, models);
      const ids = resolved.scopedModels.map(
        (scoped) => `${scoped.model.provider}/${scoped.model.id}`,
      );
      for (const diagnostic of resolved.diagnostics) {
        if (diagnostic.code === "no-match" && !ids.includes(diagnostic.pattern))
          ids.push(diagnostic.pattern);
      }
      return ids;
    };

    let currentEnabledIds =
      sessionScopedModels.length > 0
        ? sessionScopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`)
        : configuredEnabledIds(availableModels);
    let selectionChanged = false;
    return {
      availableModelIds,
      availableModels,
      configuredEnabledIds,
      currentEnabledIds,
      selectionChanged,
      sessionScopedModels,
    };
  }
}
