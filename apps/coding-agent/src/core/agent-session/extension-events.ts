import type agentTypes from "@msa/agent-core/index.types";
import * as Effect from "effect/Effect";
import { isNullish } from "effect/Predicate";

import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import platform from "../platform/index.ts";

const { nowMs } = platform;
const { awaited, awaitingWith, performed } = awaitingModule;

export default class SessionExtensionEvents {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  turnIndex = 0;

  installMessageFinalizer(): void {
    this.session.agent.finalizeMessage = (message) =>
      Effect.runPromise(this.messageEndReplacement(message));
  }

  private messageEndReplacement(message: agentTypes.AgentMessage) {
    return awaitingWith(function* () {
      const replacement = yield* awaited(
        this.session.extensions.binding.extensionRunnerInternal.emitMessageEnd({
          message,
          type: "message_end",
        }),
      );
      if (replacement === undefined) return undefined;
      return (replacement.role === "user" ||
        replacement.role === "assistant" ||
        replacement.role === "toolResult" ||
        replacement.role === "custom") &&
        isNullish(replacement.content)
        ? ({ ...replacement, content: [] } as agentTypes.AgentMessage)
        : replacement;
    }, this);
  }

  private forwardedExtensionEvent(
    event: agentTypes.AgentEvent,
  ): Parameters<extensionsTypes.ExtensionRunner["emit"]>[0] | undefined {
    switch (event.type) {
      case "agent_end":
        return { messages: event.messages, type: "agent_end" };
      case "turn_start":
        return { timestamp: nowMs(), turnIndex: this.turnIndex, type: "turn_start" };
      case "message_start":
        return { message: event.message, type: "message_start" };
      case "message_update":
        return {
          assistantMessageEvent: event.assistantMessageEvent,
          message: event.message,
          type: "message_update",
        };
      case "tool_execution_start":
        return {
          args: event.args,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: "tool_execution_start",
        };
      case "tool_execution_update":
        return {
          args: event.args,
          partialResult: event.partialResult,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: "tool_execution_update",
        };
      case "tool_execution_end":
        return {
          isError: event.isError,
          result: event.result,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: "tool_execution_end",
          ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        };
      default:
        return undefined;
    }
  }

  handleAgentEvent(event: agentTypes.AgentEvent): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (event.type === "agent_start" && this.session.run.lifecycle.agentRunAbortRequested)
          this.session.agent.abort();
        this.session.tools.calls.attachNestedCalls(event);
        if (event.type === "tool_execution_start")
          this.session.integrations.goal.goalInternal.noteToolUse();
        if (event.type === "message_start" && event.message.role === "user")
          this.session.run.queue.dequeueDeliveredUserMessage(event.message);
        yield* awaited(this.emitExtensionEvent(event));
        this.session.emit(
          event.type === "agent_end"
            ? { ...event, willRetry: this.session.run.retry.willRetryAfterAgentEnd(event) }
            : event,
        );
        if (event.type === "message_end")
          this.session.context.transcript.persistMessage(event.message);
        if (event.type === "turn_end") {
          this.session.run.lifecycle.lastAssistantToolResults = event.toolResults;
          this.session.run.prompting.flushPendingCustomMessages();
        }
      }, this),
    );
  }

  private emitExtensionEvent(event: agentTypes.AgentEvent): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (event.type === "agent_start") {
          this.turnIndex = 0;
          yield* awaited(
            this.session.extensions.binding.extensionRunnerInternal.emit({ type: "agent_start" }),
          );
          return;
        }
        if (event.type === "turn_end") {
          if (
            event.message.role === "assistant" &&
            !this.session.run.boundary.boundaryDispatchedMessages.delete(event.message)
          )
            yield* performed(
              this.session.run.boundary.dispatchTurnEndBoundary(event.message, event.toolResults),
            );
          this.turnIndex++;
          return;
        }
        if (event.type === "message_end") return;
        const forwarded = this.forwardedExtensionEvent(event);
        if (forwarded !== undefined)
          yield* awaited(this.session.extensions.binding.extensionRunnerInternal.emit(forwarded));
      }, this),
    );
  }
}
