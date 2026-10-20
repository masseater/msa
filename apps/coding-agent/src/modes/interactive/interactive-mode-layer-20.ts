import type compatTypes from "@msa/ai/compat.types";
import type tuiTypes from "@msa/tui/index.types";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import cacheStats from "../../core/cache-stats.ts";
import type cacheStatsTypes from "../../core/cache-stats.types.ts";
import AssistantMessageComponent from "./components/assistant-message.ts";
import ToolExecutionComponent from "./components/tool-execution.ts";
import type toolExecutionTypes from "./components/tool-execution.types.ts";
import ToolGroupComponent from "./components/tool-group.ts";
import InteractiveModeLayer19 from "./interactive-mode-layer-19.ts";

const { collectCacheMisses } = cacheStats;

export default abstract class InteractiveModeLayer20 extends InteractiveModeLayer19 {
  protected buildToolComponent(
    name: string,
    toolCallId: string,
    args: unknown,
  ): toolExecutionTypes.ToolExecutionComponent {
    const component = new ToolExecutionComponent(
      name,
      toolCallId,
      args,
      {
        imageWidthCells: this.settingsManager.getImageWidthCells(),
        outputPad: this.outputPad,
        showImages: this.settingsManager.getShowImages(),
      },
      this.getRegisteredToolDefinition(name),
      this.ui,
      this.sessionManager.getCwd(),
    );
    component.setExpanded(this.toolOutputExpanded);
    this.addToolExecution(component);
    return component;
  }

  protected createToolComponent(
    name: string,
    toolCallId: string,
    args: unknown,
  ): toolExecutionTypes.ToolExecutionComponent {
    const component = this.buildToolComponent(name, toolCallId, args);
    this.pendingTools.set(toolCallId, component);
    return component;
  }

  protected onToolExecutionStart(
    event: Extract<agentSessionTypes.AgentSessionEvent, { type: "tool_execution_start" }>,
  ): void {
    if (event.parentToolCallId !== undefined && event.parentToolCallId !== "") return;
    const component =
      this.pendingTools.get(event.toolCallId) ??
      this.createToolComponent(event.toolName, event.toolCallId, event.args);
    component.markExecutionStarted();
    this.ui.requestRender();
  }

  protected addToolExecution(component: toolExecutionTypes.ToolExecutionComponent): void {
    const children = this.chatContainer.children;
    const isFoldable = (child: tuiTypes.Component | undefined) =>
      child instanceof AssistantMessageComponent && !child.hasVisibleText();
    const groupIndex = this.toolGroup === undefined ? -1 : children.indexOf(this.toolGroup);
    let group = this.toolGroup;
    let folded: tuiTypes.Component[];
    if (
      group !== undefined &&
      groupIndex >= 0 &&
      children.slice(groupIndex + 1).every(isFoldable)
    ) {
      folded = children.slice(groupIndex + 1);
    } else {
      group = new ToolGroupComponent(this.outputPad);
      group.setExpanded(this.toolOutputExpanded);
      const last = children.at(-1);
      folded = isFoldable(last) && last !== undefined ? [last] : [];
      if (last instanceof AssistantMessageComponent) {
        const thinking = last.takeThinking();
        if (thinking !== undefined) folded.push(thinking);
      }
      this.toolGroup = group;
    }
    for (const child of folded) this.chatContainer.removeChild(child);
    if (!children.includes(group)) this.chatContainer.addChild(group);
    for (const child of folded) group.items.addChild(child);
    group.items.addChild(component);
  }

  protected renderSessionItemsRenderedPendingTools(options: {
    updateFooter?: boolean;
    populateHistory?: boolean;
  }): {
    renderedPendingTools: Map<string, toolExecutionTypes.ToolExecutionComponent>;
    cacheMisses: Map<compatTypes.AssistantMessage, cacheStatsTypes.CacheMiss>;
  } {
    this.pendingTools.clear();
    const renderedPendingTools = new Map<string, toolExecutionTypes.ToolExecutionComponent>();
    const cacheMisses = this.settingsManager.getShowCacheMissNotices()
      ? collectCacheMisses(this.sessionManager.getEntries(), this.session.modelRuntime)
      : new Map<compatTypes.AssistantMessage, cacheStatsTypes.CacheMiss>();

    if (options.updateFooter === true) {
      this.footer.invalidate();
      this.updateEditorBorderColor();
    }
    return { cacheMisses, renderedPendingTools };
  }
}
