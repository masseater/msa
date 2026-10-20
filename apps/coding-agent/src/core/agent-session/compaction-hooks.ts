import * as Effect from "effect/Effect";

import agentSessionHelpers from "../agent-session-helpers.ts";
import type agentSessionInternalTypes from "../agent-session-internal.types.ts";
import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import type compactionTypes from "../compaction/index.types.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { estimateMessagesTokens } = agentSessionHelpers;

export default class SessionCompactionHooks {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  emitSessionCompactFailed(
    event: Omit<extensionsTypes.SessionCompactFailedEvent, "type">,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (
        this.session.extensions.binding.extensionRunnerInternal.hasHandlers(
          "session_compact_failed",
        )
      ) {
        yield* awaited(
          this.session.extensions.binding.extensionRunnerInternal.emit({
            type: "session_compact_failed",
            ...event,
          }),
        );
      }
    }, this);
  }

  requestExtensionCompaction(run: agentSessionInternalTypes.CompactionRun) {
    return awaitingWith(function* () {
      if (
        !this.session.extensions.binding.extensionRunnerInternal.hasHandlers(
          "session_before_compact",
        )
      )
        return undefined;
      const result = (yield* awaited(
        this.session.extensions.binding.extensionRunnerInternal.emit({
          branchEntries: run.pathEntries,
          customInstructions: run.customInstructions,
          preparation: run.preparation,
          reason: run.reason,
          signal: run.signal,
          type: "session_before_compact",
          willRetry: run.willRetry,
        }),
      )) as extensionsTypes.SessionBeforeCompactResult | undefined;
      if (result?.cancel === true) {
        run.outcome.cancelledByExtension = true;
        throw new Error("Compaction cancelled");
      }
      if (result?.compaction === undefined) return undefined;
      run.outcome.fromExtension = true;
      return result.compaction;
    }, this);
  }

  commitCompaction(
    run: agentSessionInternalTypes.CompactionRun,
    compaction: compactionTypes.CompactionResult,
  ): Effect.Effect<compactionTypes.CompactionResult> {
    return awaitingWith(function* () {
      const { details, firstKeptEntryId, summary, tokensBefore, usage } = compaction;
      const { fromExtension } = run.outcome;
      this.session.sessionManager.appendCompaction(
        summary,
        firstKeptEntryId,
        tokensBefore,
        details,
        fromExtension,
        usage,
      );
      const newEntries = this.session.sessionManager.getEntries();
      this.session.context.transcript.refreshFinalizedContext();
      const estimatedTokensAfter = estimateMessagesTokens(
        this.session.sessionManager.buildSessionProjection().messages,
      );
      const savedCompactionEntry = newEntries.find(
        (e) => e.type === "compaction" && e.summary === summary,
      ) as sessionManagerTypes.CompactionEntry | undefined;
      if (savedCompactionEntry !== undefined) {
        yield* awaited(
          this.session.extensions.binding.extensionRunnerInternal.emit({
            compactionEntry: savedCompactionEntry,
            fromExtension,
            reason: run.reason,
            type: "session_compact",
            willRetry: run.willRetry,
          }),
        );
      }
      return { details, estimatedTokensAfter, firstKeptEntryId, summary, tokensBefore, usage };
    }, this);
  }
}
