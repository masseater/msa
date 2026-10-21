import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import type sessionManagerTypes from "../session-manager.types.ts";

const { isContextOverflow, isRecoverableLength } = compat;
const { awaited, awaitingWith, performed } = awaitingModule;

export default class SessionOverflowRecovery {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  overflowRecoveryAttempted = false;

  assessOverflow(
    assistantMessage: compatTypes.AssistantMessage,
    projection: sessionManagerTypes.SessionProjection,
    branch: sessionManagerTypes.SessionEntry[],
  ) {
    const messageModel = this.session.models.selection.modelForMessage(assistantMessage);
    const contextWindow = (messageModel ?? this.session.model)?.contextWindow ?? 0;
    const assistantEntryId =
      this.session.context.transcript.findPersistedMessageEntryId(assistantMessage);
    const assistantIsProjected =
      assistantEntryId === undefined ||
      projection.entries.some(
        (entry) =>
          entry.sourceEntry.id === assistantEntryId &&
          entry.messages.some((message) => message.role === "assistant"),
      );
    const assistantIndex =
      assistantEntryId !== undefined && assistantEntryId !== ""
        ? branch.findIndex((entry) => entry.id === assistantEntryId)
        : -1;
    const afterAssistant = assistantIndex >= 0 ? branch.slice(assistantIndex + 1) : [];
    const latestAssistantEdit = afterAssistant
      .filter(
        (entry): entry is sessionManagerTypes.ContextEditEntry =>
          entry.type === "context_edit" && entry.targetId === assistantEntryId,
      )
      .at(-1);
    const retainedForExplicitRecovery =
      assistantEntryId === undefined ||
      (!afterAssistant.some((entry) => entry.type === "compaction") &&
        latestAssistantEdit?.replacement !== null);
    const usageMatchesProjection =
      assistantIsProjected && !afterAssistant.some((entry) => entry.type === "context_edit");
    const explicitOverflow =
      assistantMessage.stopReason === "error" && isContextOverflow(assistantMessage);
    const contextOverflow =
      messageModel !== undefined &&
      ((explicitOverflow && retainedForExplicitRecovery) ||
        (usageMatchesProjection && isContextOverflow(assistantMessage, contextWindow)));
    const recoverableLength =
      messageModel !== undefined &&
      assistantIsProjected &&
      isRecoverableLength(assistantMessage, messageModel.maxTokens);
    return { contextOverflow, contextWindow, recoverableLength };
  }

  recoverFromOverflow(
    assistantMessage: compatTypes.AssistantMessage,
    toolResults: agentTypes.AgentMessage[],
    contextOverflow: boolean,
  ): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const willRetry = assistantMessage.stopReason !== "stop";
      if (!willRetry)
        return yield* awaited(this.session.compaction.auto.runAutoCompaction("overflow", false));
      if (this.overflowRecoveryAttempted) {
        const errorMessage = contextOverflow
          ? "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model."
          : "Truncated response recovery failed after one compact-and-retry attempt.";
        this.session.emit({
          aborted: false,
          errorMessage,
          reason: "overflow",
          result: undefined,
          type: "compaction_end",
          willRetry: false,
        });
        yield* performed(
          this.session.compaction.hooks.emitSessionCompactFailed({
            aborted: false,
            errorMessage,
            fromExtension: false,
            reason: "overflow",
            willRetry: false,
          }),
        );
        return false;
      }
      this.overflowRecoveryAttempted = true;
      this.session.run.retry.omitRecoveryAttempt(assistantMessage, toolResults);
      const retry = yield* awaited(
        this.session.compaction.auto.runAutoCompaction("overflow", willRetry),
      );
      if (retry) this.session.run.lifecycle.failedResponse = assistantMessage;
      return retry;
    }, this);
  }
}
