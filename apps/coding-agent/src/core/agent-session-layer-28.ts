import ai from "@msa/ai";
import * as Effect from "effect/Effect";

import AgentSessionLayer27 from "./agent-session-layer-27.ts";
import awaitingModule from "./awaiting.ts";
import compactionModule from "./compaction/index.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import goalModule from "./goal.ts";
import platform from "./platform.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { collectEntriesForBranchSummary, completeSummarization } = compactionModule;
const { contentText, normalizeContext } = ai;
const { nowMs } = platform;
const { GOAL_EVALUATOR_SYSTEM_PROMPT } = goalModule;

export default abstract class AgentSessionLayer28 extends AgentSessionLayer27 {
  protected evaluateGoal(prompt: string, signal: AbortSignal): Effect.Effect<string> {
    return awaitingWith(function* () {
      const {
        model,
        thinkingLevel: _thinkingLevel,
        ...credentials
      } = yield* performed(this.getSummarizationRequestAuth(this.goalEvaluatorModel(), signal));
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
            sessionId: this.sessionId,
            signal,
          },
          this.agent.streamFunction,
          this.settingsManager.getRetrySettings(),
        ),
      );
      if (response.usage !== undefined) {
        const entry = this.sessionManager.appendUsage(
          "goal_evaluation",
          response.provider,
          response.model,
          response.usage,
        );
        this.emit({ entry, type: "entry_appended" });
      }
      if (response.stopReason === "aborted") throw new Error("cancelled");
      if (response.stopReason === "error")
        throw new Error(response.errorMessage || "Unknown error");
      if (response.stopReason === "length") throw new Error("the response hit the token cap");
      return contentText(response.content, "\n").trim();
    }, this);
  }

  navigateTree(
    targetId: string,
    options: {
      summarize?: boolean | undefined;
      customInstructions?: string | undefined;
      replaceInstructions?: boolean | undefined;
      label?: string | undefined;
    } = {},
  ): Promise<{
    editorText?: string | undefined;
    cancelled: boolean;
    aborted?: boolean;
    summaryEntry?: sessionManagerTypes.BranchSummaryEntry | undefined;
  }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        this.assertTreeNavigable();
        const oldLeafId = this.sessionManager.getLeafId();
        if (targetId === oldLeafId) return { cancelled: false };
        if (options.summarize === true && this.model === undefined)
          throw new Error("No model available for summarization");
        const targetEntry = this.sessionManager.getEntry(targetId);
        if (targetEntry === undefined) throw new Error(`Entry ${targetId} not found`);
        const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
          this.sessionManager,
          oldLeafId,
          targetId,
        );
        const preparation: extensionsTypes.TreePreparation = {
          commonAncestorId,
          customInstructions: options.customInstructions,
          entriesToSummarize,
          label: options.label,
          oldLeafId,
          replaceInstructions: options.replaceInstructions,
          targetId,
          userWantsSummary: options.summarize ?? false,
        };
        const controller = new AbortController();
        this.branchSummaryAbortController = controller;
        try {
          return yield* performed(this.navigateTreeTo(targetEntry, preparation, controller.signal));
        } finally {
          this.branchSummaryAbortController = undefined;
          this.resolveIdleWaitIfIdle();
        }
      }, this),
    );
  }
}
