import agentModule from "@msa/agent-core";
import type agentTypes from "@msa/agent-core/index.types";
import * as Effect from "effect/Effect";

import toolResultImages from "../../utils/tool-result-images.ts";
import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import NestedToolCallRunner from "../nested-tool-call-runner.ts";
import type nestedToolCallsTypes from "../nested-tool-calls.types.ts";
import usageTotalsModule from "../usage-totals.ts";

const { awaited, awaitingWith } = awaitingModule;
const { combineUsage } = usageTotalsModule;
const { normalizeToolResultImages } = toolResultImages;
const { runToolCall } = agentModule;

export default class SessionToolCalls {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  private nestedToolCalls: nestedToolCallsTypes.NestedToolCallRunner | undefined;

  private emitToolResultHook(
    { toolCall, args, result, isError }: agentTypes.AfterToolCallContext,
    parentToolCallId: string | undefined,
  ) {
    const runner = this.session.extensions.binding.extensionRunnerInternal;
    if (!runner.hasHandlers("tool_result")) return Promise.resolve(undefined);
    return runner.emitToolResult({
      content: result.content,
      details: result.details,
      input: args as Record<string, unknown>,
      isError,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      type: "tool_result",
      usage: result.usage,
      ...(parentToolCallId !== undefined && parentToolCallId !== "" ? { parentToolCallId } : {}),
      ...(result.structuredContent === undefined
        ? {}
        : { structuredContent: result.structuredContent }),
    });
  }

  attachNestedCalls(event: agentTypes.AgentEvent): void {
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

  installAgentToolHooks(): void {
    this.session.agent.beforeToolCall = (context) =>
      Effect.runPromise(this.beforeToolCall(context));
    this.session.agent.afterToolCall = (context) => Effect.runPromise(this.afterToolCall(context));
  }

  private beforeToolCall(
    { toolCall, args }: agentTypes.BeforeToolCallContext,
    parentToolCallId?: string,
  ): Effect.Effect<agentTypes.BeforeToolCallResult | undefined> {
    return awaitingWith(function* () {
      const runner = this.session.extensions.binding.extensionRunnerInternal;
      if (!runner.hasHandlers("tool_call")) {
        return undefined;
      }

      try {
        return yield* awaited(
          runner.emitToolCall({
            input: args as Record<string, unknown>,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            type: "tool_call",
            ...(parentToolCallId !== undefined && parentToolCallId !== ""
              ? { parentToolCallId }
              : {}),
          }),
        );
      } catch (err) {
        if (err instanceof Error) {
          throw err;
        }
        throw new Error(`Extension failed, blocking execution: ${String(err)}`, { cause: err });
      }
    }, this);
  }

  private afterToolCall(
    context: agentTypes.AfterToolCallContext,
    parentToolCallId?: string,
  ): Effect.Effect<agentTypes.AfterToolCallResult | undefined> {
    const { result, isError } = context;
    return awaitingWith(function* () {
      const hookResult = yield* awaited(this.emitToolResultHook(context, parentToolCallId));
      const content = hookResult?.content ?? result.content ?? [];
      const resizeOptions =
        this.session.models.selection.limitsModel()?.inputLimits?.images?.resize;
      const normalizedContent = yield* awaited(
        normalizeToolResultImages(content, {
          autoResizeImages: this.session.settingsManager.getImageAutoResize(),
          ...(resizeOptions === undefined ? {} : { resizeOptions }),
        }),
      );

      if (hookResult === undefined && normalizedContent === content) {
        return undefined;
      }

      const details = hookResult?.details;
      const structuredContent =
        hookResult === undefined ? result.structuredContent : hookResult.structuredContent;
      const usage = hookResult?.usage;
      return {
        content: normalizedContent,
        ...(details === undefined ? {} : { details }),
        ...(structuredContent === undefined ? {} : { structuredContent }),
        isError: hookResult?.isError ?? isError,
        ...(usage === undefined ? {} : { usage }),
      };
    }, this);
  }

  executeNestedToolCall(
    parentToolCallId: string,
    name: string,
    args: unknown,
    options: extensionsTypes.ExecuteToolOptions,
  ): Effect.Effect<agentTypes.AgentToolCallOutcome> {
    return awaitingWith(function* () {
      this.nestedToolCalls ??= new NestedToolCallRunner({
        emit: (event) =>
          Effect.runPromise(
            awaitingWith(function* () {
              yield* awaited(this.session.extensions.binding.extensionRunnerInternal.emit(event));
              this.session.emit(event);
            }, this),
          ),
        getTools: () => this.session.tools.loadout.getCallableTools(),
        isSequential: () => this.session.agent.toolExecution === "sequential",
        runToolCall: (toolCall, parentId, signal, onUpdate) => {
          const assistantMessage = this.session.context.transcript.findLastAssistantMessage();
          if (assistantMessage === undefined) {
            return Promise.resolve({
              isError: true,
              result: {
                content: [{ text: "No assistant message issued this call", type: "text" }],
                details: {},
              },
              toolCall,
            });
          }
          return runToolCall(toolCall, {
            afterToolCall: (context) => Effect.runPromise(this.afterToolCall(context, parentId)),
            assistantMessage,
            beforeToolCall: (context) => Effect.runPromise(this.beforeToolCall(context, parentId)),
            context: {
              messages: this.session.agent.state.messages,
              tools: this.session.agent.state.tools,
            },
            onUpdate,
            tools: this.session.tools.loadout.getCallableTools(),
            ...(signal === undefined ? {} : { signal }),
          });
        },
      });
      return yield* awaited(this.nestedToolCalls.execute(parentToolCallId, name, args, options));
    }, this);
  }
}
