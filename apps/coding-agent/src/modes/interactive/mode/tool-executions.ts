import type tuiTypes from "@msa/tui/index.types";

import type agentSessionTypes from "../../../core/agent-session.types.ts";
import renderers from "../../../core/tools/renderers/index.ts";
import AssistantMessageComponent from "../components/assistant-message.ts";
import ToolExecutionComponent from "../components/tool-execution.ts";
import type toolExecutionTypes from "../components/tool-execution.types.ts";
import ToolGroupComponent from "../components/tool-group.ts";
import type toolGroupTypes from "../components/tool-group.types.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { withBuiltInRenderers } = renderers;

export default class ToolExecutionsView {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  pendingTools = new Map<string, toolExecutionTypes.ToolExecutionComponent>();

  toolGroup?: toolGroupTypes.ToolGroupComponent;

  private getRegisteredToolDefinition(toolName: string) {
    return this.mode.session.extensions.binding.extensionRunner.resolveToolRenderers(toolName, () =>
      withBuiltInRenderers(toolName, this.mode.session.tools.registry.getToolDefinition(toolName)),
    );
  }

  onToolExecutionEnd(
    event: Extract<agentSessionTypes.AgentSessionEvent, { type: "tool_execution_end" }>,
  ): void {
    if (event.isError) this.mode.display.notices.warnings.maybeShowInstallChangeWarning();
    const component = this.pendingTools.get(event.toolCallId);
    if (component === undefined) return;
    component.updateResult({
      ...event.result,
      durationMs: event.durationMs,
      isError: event.isError,
    });
    this.pendingTools.delete(event.toolCallId);
    this.mode.ui.requestRender();
  }

  buildToolComponent(
    name: string,
    toolCallId: string,
    args: unknown,
  ): toolExecutionTypes.ToolExecutionComponent {
    const component = new ToolExecutionComponent(
      name,
      toolCallId,
      args,
      {
        imageWidthCells: this.mode.settingsManager.display.getImageWidthCells(),
        outputPad: this.mode.display.thinking.outputPad,
        showImages: this.mode.settingsManager.display.getShowImages(),
      },
      this.getRegisteredToolDefinition(name),
      this.mode.ui,
      this.mode.sessionManager.getCwd(),
    );
    component.setExpanded(this.mode.display.resources.toolOutputExpanded);
    this.addToolExecution(component);
    return component;
  }

  createToolComponent(
    name: string,
    toolCallId: string,
    args: unknown,
  ): toolExecutionTypes.ToolExecutionComponent {
    const component = this.buildToolComponent(name, toolCallId, args);
    this.pendingTools.set(toolCallId, component);
    return component;
  }

  onToolExecutionStart(
    event: Extract<agentSessionTypes.AgentSessionEvent, { type: "tool_execution_start" }>,
  ): void {
    if (event.parentToolCallId !== undefined && event.parentToolCallId !== "") return;
    const component =
      this.pendingTools.get(event.toolCallId) ??
      this.createToolComponent(event.toolName, event.toolCallId, event.args);
    component.markExecutionStarted();
    this.mode.ui.requestRender();
  }

  private addToolExecution(component: toolExecutionTypes.ToolExecutionComponent): void {
    const children = this.mode.layout.chatContainer.children;
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
      group = new ToolGroupComponent(this.mode.display.thinking.outputPad);
      group.setExpanded(this.mode.display.resources.toolOutputExpanded);
      const last = children.at(-1);
      folded = isFoldable(last) && last !== undefined ? [last] : [];
      if (last instanceof AssistantMessageComponent) {
        const thinking = last.takeThinking();
        if (thinking !== undefined) folded.push(thinking);
      }
      this.toolGroup = group;
    }
    for (const child of folded) this.mode.layout.chatContainer.removeChild(child);
    if (!children.includes(group)) this.mode.layout.chatContainer.addChild(group);
    for (const child of folded) group.items.addChild(child);
    group.items.addChild(component);
  }

  *chatComponents(): Generator<tuiTypes.Component> {
    for (const child of this.mode.layout.chatContainer.children) {
      yield child;
      if (child instanceof ToolGroupComponent) yield* child.items.children;
    }
  }
}
