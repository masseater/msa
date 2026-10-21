import agentModule from "@msa/agent-core";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import cliAgents from "../cli-agents/index.ts";
import contextBreakdown from "../context-breakdown.ts";
import type contextBreakdownTypes from "../context-breakdown.types.ts";

const { declareToolChanges } = agentModule;
const { measureContextBreakdown } = contextBreakdown;
const { isCliAgentProvider } = cliAgents;

export default class SessionContextBreakdown {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  getContextBreakdown(): Promise<contextBreakdownTypes.ContextBreakdown> {
    const model = this.session.models.selection.limitsModel();
    const thinkingLevel =
      this.session.models.selection.routedModel?.thinkingLevel ?? this.session.thinkingLevel;
    const transformContext = this.session.agent.transformContext;
    const transcript = this.session.agent.state.messages;
    const update = this.session.tools.prompt.promptUpdate(
      this.session.tools.prompt.nextTurnPromptOptions(),
      transcript,
    );
    const pending = declareToolChanges({
      context: { messages: transcript, tools: this.session.agent.state.tools },
      messages: update === undefined ? [] : [update],
    });
    return Effect.runPromise(
      measureContextBreakdown({
        addingProvider:
          model !== undefined && isCliAgentProvider(model.provider) ? model.provider : undefined,
        convertToLlm: (messages) => this.session.agent.convertToLlm(messages),
        countTokens: (messages) =>
          model === undefined
            ? Promise.resolve(undefined)
            : this.session.models.selection.modelRuntimeInternal.countTokens(
                model,
                { messages },
                {
                  sessionId: this.session.sessionId,
                  ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel }),
                },
              ),
        messages: transcript,
        pending,
        transformContext:
          transformContext === undefined ? undefined : (messages) => transformContext(messages),
        usageTokens: this.session.context.stats.getContextUsage()?.tokens ?? null,
      }),
    );
  }
}
