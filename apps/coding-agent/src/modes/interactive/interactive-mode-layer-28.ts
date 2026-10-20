import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import type cacheStatsTypes from "../../core/cache-stats.types.ts";
import type toolExecutionTypes from "./components/tool-execution.types.ts";
import InteractiveModeLayer27 from "./interactive-mode-layer-27.ts";

export default abstract class InteractiveModeLayer28 extends InteractiveModeLayer27 {
  protected onMessageEnd(message: agentTypes.AgentMessage): void {
    if (message.role === "user") return;
    if (this.streamingComponent !== undefined && message.role === "assistant")
      this.finishStreamingMessage(message);
    this.ui.requestRender();
  }

  protected handleStreamEvent(event: agentSessionTypes.AgentSessionEvent): boolean {
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
        this.onToolExecutionStart(event);
        return true;
      case "tool_execution_update": {
        const component = this.pendingTools.get(event.toolCallId);
        component?.updateResult({ ...event.partialResult, isError: false }, true);
        if (component !== undefined) this.ui.requestRender();
        return true;
      }
      case "tool_execution_end":
        this.onToolExecutionEnd(event);
        return true;
      case "agent_end":
        this.onAgentEnd();
        return true;
      default:
        return false;
    }
  }

  protected replayAssistantItem(
    message: compatTypes.AssistantMessage,
    renderedPendingTools: Map<string, toolExecutionTypes.ToolExecutionComponent>,
    cacheMisses: Map<compatTypes.AssistantMessage, cacheStatsTypes.CacheMiss>,
  ): void {
    this.addMessageToChat(message);
    const failed = message.stopReason === "aborted" || message.stopReason === "error";
    for (const content of message.content) {
      if (content.type !== "toolCall") continue;
      const component = this.buildToolComponent(content.name, content.id, content.arguments);
      if (!failed) {
        renderedPendingTools.set(content.id, component);
        continue;
      }
      const retryAttempt = this.session.retryAttempt;
      const abortedText =
        retryAttempt > 0
          ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
          : "Operation aborted";
      const errorText = message.errorMessage ?? "";
      const text =
        message.stopReason === "aborted" ? abortedText : errorText === "" ? "Error" : errorText;
      component.updateResult({ content: [{ text, type: "text" }], isError: true });
    }
    if (failed) return;
    const miss = cacheMisses.get(message);
    if (miss !== undefined) this.addCacheMissNotice(miss);
  }
}
