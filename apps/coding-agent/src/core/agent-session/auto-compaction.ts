import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import compactionModule from "../compaction/index.ts";
import platform from "../platform/index.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionContext from "../session-manager/session-context.ts";
import virtualModels from "../virtual-models.ts";

const { toEpochMs } = platform;
const { isVirtualModel } = virtualModels;
const { awaited, awaitingWith, performed } = awaitingModule;
const { estimateProjectedContextTokens, shouldCompact, prepareCompaction } = compactionModule;
const { getLatestCompactionEntry } = sessionContext;

export default class SessionAutoCompaction {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  autoCompactionAbortController: AbortController | undefined = undefined;

  setAutoCompactionEnabled(enabled: boolean): void {
    this.session.settingsManager.context.setCompactionEnabled(enabled);
  }

  get autoCompactionEnabled(): boolean {
    return this.session.settingsManager.context.getCompactionEnabled();
  }

  private reportAutoCompactionFailure(
    error: unknown,
    reason: "overflow" | "threshold",
    aborted: boolean,
    fromExtension: boolean,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const message = error instanceof Error ? error.message : "compaction failed";
      const failure =
        reason === "overflow"
          ? `Context overflow recovery failed: ${message}`
          : `Auto-compaction failed: ${message}`;
      const errorMessage = aborted ? undefined : failure;
      this.session.emit({
        aborted,
        errorMessage,
        reason,
        result: undefined,
        type: "compaction_end",
        willRetry: false,
      });
      yield* performed(
        this.session.compaction.hooks.emitSessionCompactFailed({
          aborted,
          errorMessage,
          fromExtension,
          reason,
          willRetry: false,
        }),
      );
    }, this);
  }

  exceedsCompactionThreshold(
    model: compatTypes.Model<any>,
    projection: sessionManagerTypes.SessionProjection,
  ): boolean {
    if (model.contextWindow <= 0) return false;
    return shouldCompact(
      estimateProjectedContextTokens(projection, this.session.sessionManager.getBranch()).tokens,
      model.contextWindow,
      this.session.settingsManager.context.getCompactionSettings(this.session.model),
    );
  }

  runAutoCompaction(reason: "overflow" | "threshold", willRetry: boolean): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const model = this.session.model;
        const settings = this.session.settingsManager.context.getCompactionSettings(model);
        const outcome = { cancelledByExtension: false, fromExtension: false };
        let abortController: AbortController | undefined;
        try {
          if (model === undefined) return false;
          const pathEntries = this.session.sessionManager.getBranch();
          const preparation = prepareCompaction(pathEntries, settings);
          if (preparation === undefined) return false;
          abortController = new AbortController();
          this.autoCompactionAbortController = abortController;
          this.session.emit({ reason, type: "compaction_start" });
          const result = yield* performed(
            this.session.compaction.manual.performCompaction({
              customInstructions: undefined,
              manual: false,
              model,
              outcome,
              pathEntries,
              preparation,
              reason,
              signal: abortController.signal,
              willRetry,
            }),
          );
          this.session.emit({ aborted: false, reason, result, type: "compaction_end", willRetry });
          return willRetry || this.session.agent.hasQueuedMessages();
        } catch (error) {
          if (abortController !== undefined) {
            const aborted = abortController.signal.aborted || outcome.cancelledByExtension;
            yield* performed(
              this.reportAutoCompactionFailure(error, reason, aborted, outcome.fromExtension),
            );
          }
          return false;
        } finally {
          if (this.autoCompactionAbortController === abortController)
            this.autoCompactionAbortController = undefined;
          this.session.run.lifecycle.resolveIdleWaitIfIdle();
        }
      }, this),
    );
  }

  compactBeforeNextAssistantResponse(
    context: agentTypes.AgentContext,
  ): Effect.Effect<agentTypes.AgentContext> {
    return awaitingWith(function* () {
      const projection = this.session.sessionManager.buildSessionProjection();
      const model = this.session.model;
      if (
        model === undefined ||
        isVirtualModel(model) ||
        !this.exceedsCompactionThreshold(model, projection)
      ) {
        return { ...context, messages: projection.messages };
      }
      yield* awaited(this.runAutoCompaction("threshold", false));
      return {
        ...context,
        messages: this.session.sessionManager.buildSessionProjection().messages,
      };
    }, this);
  }

  checkCompaction(
    assistantMessage: compatTypes.AssistantMessage,
    skipAbortedCheck = true,
    toolResults: agentTypes.AgentMessage[] = [],
  ): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const settings = this.session.settingsManager.context.getCompactionSettings(
          this.session.model,
        );
        if (!settings.enabled) return false;
        if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;
        const branch = this.session.sessionManager.getBranch();
        const compactionEntry = getLatestCompactionEntry(branch);
        if (
          compactionEntry !== null &&
          assistantMessage.timestamp <= toEpochMs(compactionEntry.timestamp)
        )
          return false;
        const projection = this.session.sessionManager.buildSessionProjection();
        const overflow = this.session.compaction.overflow.assessOverflow(
          assistantMessage,
          projection,
          this.session.sessionManager.getBranch(),
        );
        if (overflow.contextOverflow || overflow.recoverableLength)
          return yield* performed(
            this.session.compaction.overflow.recoverFromOverflow(
              assistantMessage,
              toolResults,
              overflow.contextOverflow,
            ),
          );
        const contextTokens = this.session.context.stats.measureContextTokens(
          assistantMessage,
          projection,
          branch,
          compactionEntry,
        );
        if (contextTokens === undefined) return false;
        if (shouldCompact(contextTokens, overflow.contextWindow, settings))
          return yield* awaited(this.runAutoCompaction("threshold", false));
        return false;
      }, this),
    );
  }
}
