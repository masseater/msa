import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import authGuidance from "../auth-guidance.ts";
import awaitingModule from "../awaiting.ts";
import compactionModule from "../compaction/index.ts";
import goalModule from "../goal.ts";
import modelResolver from "../model-resolver.ts";
import platform from "../platform/index.ts";

const { nowMs } = platform;
const { pickEvaluatorModel, GOAL_EVALUATOR_SYSTEM_PROMPT } = goalModule;
const { contentText, normalizeContext } = ai;
const { awaited, awaitingWith, performed } = awaitingModule;
const { resolveModelReference } = modelResolver;
const { formatNoModelSelectedMessage } = authGuidance;
const { completeSummarization } = compactionModule;

export default class SessionGoalEvaluation {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  private goalEvaluatorModel(): compatTypes.Model<any> {
    const configured = this.session.settingsManager.models.getGoalEvaluatorModel();
    const available = this.session.models.selection.modelRuntimeInternal.getAvailableSnapshot();
    if (configured !== undefined && configured !== "") {
      const result = resolveModelReference(
        { fuzzy: false, text: configured, thinkingSuffix: "none" },
        available,
        () => true,
      );
      if (result.status !== "resolved") {
        throw new Error(`goal.evaluatorModel "${configured}" is not an available model`);
      }
      return result.model;
    }
    const current = this.session.models.selection.limitsModel();
    if (current === undefined) throw new Error(formatNoModelSelectedMessage());
    return pickEvaluatorModel(current, available);
  }

  evaluateGoal(prompt: string, signal: AbortSignal): Effect.Effect<string> {
    return awaitingWith(function* () {
      const {
        model,
        thinkingLevel: _thinkingLevel,
        ...credentials
      } = yield* performed(
        this.session.models.auth.getSummarizationRequestAuth(this.goalEvaluatorModel(), signal),
      );
      const response = yield* awaited(
        completeSummarization(
          model,
          normalizeContext({
            messages: [
              { content: [{ text: prompt, type: "text" }], role: "user", timestamp: nowMs() },
            ],
            systemPrompt: GOAL_EVALUATOR_SYSTEM_PROMPT,
          }),
          {
            ...credentials,
            maxTokens: Math.min(2048, model.maxTokens > 0 ? model.maxTokens : 2048),
            sessionId: this.session.sessionId,
            signal,
          },
          this.session.agent.streamFunction,
          this.session.settingsManager.session.getRetrySettings(),
        ),
      );
      if (response.usage !== undefined) {
        const entry = this.session.sessionManager.appendUsage(
          "goal_evaluation",
          response.provider,
          response.model,
          response.usage,
        );
        this.session.emit({ entry, type: "entry_appended" });
      }
      if (response.stopReason === "aborted") throw new Error("cancelled");
      if (response.stopReason === "error")
        throw new Error(response.errorMessage || "Unknown error");
      if (response.stopReason === "length") throw new Error("the response hit the token cap");
      return contentText(response.content, "\n").trim();
    }, this);
  }
}
