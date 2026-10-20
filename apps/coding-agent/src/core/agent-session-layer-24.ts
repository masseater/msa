import * as Effect from "effect/Effect";

import agentSessionHelpers from "./agent-session-helpers.ts";
import type agentSessionInternalTypes from "./agent-session-internal.types.ts";
import AgentSessionLayer23 from "./agent-session-layer-23.ts";
import awaitingModule from "./awaiting.ts";
import type compactionTypes from "./compaction/index.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { estimateMessagesTokens } = agentSessionHelpers;

export default abstract class AgentSessionLayer24 extends AgentSessionLayer23 {
  protected commitCompaction(
    run: agentSessionInternalTypes.CompactionRun,
    compaction: compactionTypes.CompactionResult,
  ): Effect.Effect<compactionTypes.CompactionResult> {
    return awaitingWith(function* () {
      const { details, firstKeptEntryId, summary, tokensBefore, usage } = compaction;
      const { fromExtension } = run.outcome;
      this.sessionManager.appendCompaction(
        summary,
        firstKeptEntryId,
        tokensBefore,
        details,
        fromExtension,
        usage,
      );
      const newEntries = this.sessionManager.getEntries();
      this.refreshFinalizedContext();
      const estimatedTokensAfter = estimateMessagesTokens(
        this.sessionManager.buildSessionProjection().messages,
      );
      const savedCompactionEntry = newEntries.find(
        (e) => e.type === "compaction" && e.summary === summary,
      ) as sessionManagerTypes.CompactionEntry | undefined;
      if (savedCompactionEntry !== undefined) {
        yield* awaited(
          this.extensionRunnerInternal.emit({
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
