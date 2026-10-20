import agentModule from "@msa/agent-core";
import type agentTypes from "@msa/agent-core/index.types";
import * as Effect from "effect/Effect";

import AgentSessionLayer20 from "./agent-session-layer-20.ts";
import awaitingModule from "./awaiting.ts";
import cliAgents from "./cli-agents/index.ts";
import contextBreakdown from "./context-breakdown.ts";
import type contextBreakdownTypes from "./context-breakdown.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import NestedToolCallRunner from "./nested-tool-call-runner.ts";

const { awaited, awaitingWith } = awaitingModule;
const { declareToolChanges, runToolCall } = agentModule;
const { measureContextBreakdown } = contextBreakdown;
const { isCliAgentProvider } = cliAgents;

export default abstract class AgentSessionLayer21 extends AgentSessionLayer20 {
  protected executeNestedToolCall(
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
              yield* awaited(this.extensionRunnerInternal.emit(event));
              this.emit(event);
            }, this),
          ),
        getTools: () => this.getCallableTools(),
        isSequential: () => this.agent.toolExecution === "sequential",
        runToolCall: (toolCall, parentId, signal, onUpdate) => {
          const assistantMessage = this.findLastAssistantMessage();
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
            context: { messages: this.agent.state.messages, tools: this.agent.state.tools },
            onUpdate,
            tools: this.getCallableTools(),
            ...(signal === undefined ? {} : { signal }),
          });
        },
      });
      return yield* awaited(this.nestedToolCalls.execute(parentToolCallId, name, args, options));
    }, this);
  }

  getContextBreakdown(): Promise<contextBreakdownTypes.ContextBreakdown> {
    const model = this.limitsModel();
    const thinkingLevel = this.routedModel?.thinkingLevel ?? this.thinkingLevel;
    const transformContext = this.agent.transformContext;
    const transcript = this.agent.state.messages;
    const update = this.promptUpdate(this.nextTurnPromptOptions(), transcript);
    const pending = declareToolChanges({
      context: { messages: transcript, tools: this.agent.state.tools },
      messages: update === undefined ? [] : [update],
    });
    return Effect.runPromise(
      measureContextBreakdown({
        addingProvider:
          model !== undefined && isCliAgentProvider(model.provider) ? model.provider : undefined,
        convertToLlm: (messages) => this.agent.convertToLlm(messages),
        countTokens: (messages) =>
          model === undefined
            ? Promise.resolve(undefined)
            : this.modelRuntimeInternal.countTokens(
                model,
                { messages },
                {
                  sessionId: this.sessionId,
                  ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel }),
                },
              ),
        messages: transcript,
        pending,
        transformContext:
          transformContext === undefined ? undefined : (messages) => transformContext(messages),
        usageTokens: this.getContextUsage()?.tokens ?? null,
      }),
    );
  }
}
