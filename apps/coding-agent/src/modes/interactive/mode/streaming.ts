import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type agentSessionTypes from "../../../core/agent-session.types.ts";
import AssistantMessageComponent from "../components/assistant-message.ts";
import type assistantMessageTypes from "../components/assistant-message.types.ts";
import type InteractiveMode from "../interactive-mode.ts";

export default class StreamingView {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  streamingComponent: assistantMessageTypes.AssistantMessageComponent | undefined = undefined;

  streamingMessage: compatTypes.AssistantMessage | undefined = undefined;

  private onAgentStart(): void {
    this.mode.view.toolExecutions.pendingTools.clear();
    if (this.mode.display.operationStatus.retryEscapeHandler === undefined) return;
    this.mode.defaultEditor.onEscape = this.mode.display.operationStatus.retryEscapeHandler;
    this.mode.display.operationStatus.retryEscapeHandler = undefined;
  }

  private onAgentEnd(): void {
    if (this.mode.settingsManager.getShowTerminalProgress())
      this.mode.ui.terminal.setProgress(false);
    this.mode.display.indicator.clearStatusIndicator("working");
    if (this.streamingComponent !== undefined) {
      this.mode.layout.chatContainer.removeChild(this.streamingComponent);
      this.mode.view.toolExecutions.toolGroup?.items.removeChild(this.streamingComponent);
      const thinking = this.streamingComponent.takenThinking;
      if (thinking !== undefined)
        this.mode.view.toolExecutions.toolGroup?.items.removeChild(thinking);
      this.streamingComponent = undefined;
      this.streamingMessage = undefined;
    }
    this.mode.view.toolExecutions.pendingTools.clear();
    this.mode.ui.requestRender();
  }

  private onTurnStart(): void {
    if (this.mode.settingsManager.getShowTerminalProgress())
      this.mode.ui.terminal.setProgress(true);
    if (!this.mode.display.indicator.workingVisible)
      this.mode.display.indicator.clearStatusIndicator();
    else if (this.mode.display.indicator.activeStatusIndicator?.kind !== "working")
      this.mode.display.indicator.showWorkingStatusIndicator();
    this.mode.ui.requestRender();
  }

  private onMessageUpdate(message: agentTypes.AgentMessage): void {
    if (this.streamingComponent === undefined || message.role !== "assistant") return;
    this.streamingMessage = message;
    this.streamingComponent.updateContent(this.streamingMessage, true);
    for (const content of this.streamingMessage.content) {
      if (content.type !== "toolCall") continue;
      const existing = this.mode.view.toolExecutions.pendingTools.get(content.id);
      if (existing === undefined)
        this.mode.view.toolExecutions.createToolComponent(
          content.name,
          content.id,
          content.arguments,
        );
      else existing.updateArgs(content.arguments);
    }
    this.mode.ui.requestRender();
  }

  private onMessageStart(message: agentTypes.AgentMessage): void {
    if (message.role === "custom" || message.role === "user") {
      this.mode.view.messages.addMessageToChat(message);
      if (message.role === "user") this.mode.input.queue.updatePendingMessagesDisplay();
      this.mode.ui.requestRender();
      return;
    }
    if (message.role !== "assistant") return;
    this.streamingComponent = new AssistantMessageComponent(
      undefined,
      this.mode.display.thinking.hideThinkingBlock,
      this.mode.view.messages.getMarkdownThemeWithSettings(),
      this.mode.display.thinking.hiddenThinkingLabel,
      this.mode.display.thinking.outputPad,
      this.mode.view.messages.getMarkdownTransformers(),
    );
    this.streamingMessage = message;
    this.mode.layout.chatContainer.addChild(this.streamingComponent);
    this.streamingComponent.updateContent(this.streamingMessage, true);
    this.mode.ui.requestRender();
  }

  private finishStreamingMessage(message: compatTypes.AssistantMessage): void {
    this.streamingMessage = message;
    let errorMessage: string | undefined;
    if (message.stopReason === "aborted") {
      const retryAttempt = this.mode.session.run.retry.retryAttempt;
      errorMessage =
        retryAttempt > 0
          ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
          : "Operation aborted";
      message.errorMessage = errorMessage;
    }
    this.streamingComponent?.updateContent(message, false);
    if (message.stopReason === "aborted" || message.stopReason === "error") {
      const text =
        errorMessage === undefined || errorMessage === ""
          ? (message.errorMessage ?? "") === ""
            ? "Error"
            : message.errorMessage!
          : errorMessage;
      for (const [, component] of this.mode.view.toolExecutions.pendingTools.entries())
        component.updateResult({ content: [{ text, type: "text" }], isError: true });
      this.mode.view.toolExecutions.pendingTools.clear();
      this.mode.display.notices.warnings.maybeSuggestBugReport(message);
    } else {
      for (const [, component] of this.mode.view.toolExecutions.pendingTools.entries())
        component.setArgsComplete();
      this.mode.display.notices.usage.maybeShowThinkingDropNotice(message);
      this.mode.display.notices.cache.maybeShowCacheMissNotice(message);
    }
    this.streamingComponent = undefined;
    this.streamingMessage = undefined;
    this.mode.footer.invalidate();
  }

  private onMessageEnd(message: agentTypes.AgentMessage): void {
    if (message.role === "user") return;
    if (this.streamingComponent !== undefined && message.role === "assistant")
      this.finishStreamingMessage(message);
    this.mode.ui.requestRender();
  }

  handleStreamEvent(event: agentSessionTypes.AgentSessionEvent): boolean {
    switch (event.type) {
      case "agent_start":
        this.onAgentStart();
        return true;
      case "turn_start":
        this.onTurnStart();
        return true;
      case "message_start":
        this.onMessageStart(event.message);
        return true;
      case "message_update":
        this.onMessageUpdate(event.message);
        return true;
      case "message_end":
        this.onMessageEnd(event.message);
        return true;
      case "tool_execution_start":
        this.mode.view.toolExecutions.onToolExecutionStart(event);
        return true;
      case "tool_execution_update": {
        const component = this.mode.view.toolExecutions.pendingTools.get(event.toolCallId);
        component?.updateResult({ ...event.partialResult, isError: false }, true);
        if (component !== undefined) this.mode.ui.requestRender();
        return true;
      }
      case "tool_execution_end":
        this.mode.view.toolExecutions.onToolExecutionEnd(event);
        return true;
      case "agent_end":
        this.onAgentEnd();
        return true;
      default:
        return false;
    }
  }
}
