import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import errors from "../../utils/errors.ts";
import type agentSessionInternalTypes from "../agent-session-internal.types.ts";
import type AgentSession from "../agent-session.ts";
import authGuidance from "../auth-guidance.ts";
import awaitingModule from "../awaiting.ts";
import compactionModule from "../compaction/index.ts";
import type compactionTypes from "../compaction/index.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { toErrorMessage } = errors;
const { formatNoModelSelectedMessage } = authGuidance;
const { compact, prepareCompaction } = compactionModule;

export default class SessionCompaction {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  compactionAbortController: AbortController | undefined = undefined;

  get isCompacting(): boolean {
    return (
      this.session.compaction.auto.autoCompactionAbortController !== undefined ||
      this.compactionAbortController !== undefined ||
      this.session.context.tree.branchSummaryAbortController !== undefined
    );
  }

  private clearManualCompactionState(): void {
    this.compactionAbortController = undefined;
    this.session.run.lifecycle.resolveIdleWaitIfIdle();
  }

  abortCompaction(): void {
    this.compactionAbortController?.abort();
    this.session.compaction.auto.autoCompactionAbortController?.abort();
  }

  private reportManualCompactionFailure(
    error: unknown,
    signal: AbortSignal,
    outcome: agentSessionInternalTypes.CompactionOutcome,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const aborted = signal.aborted || outcome.cancelledByExtension;
      const errorMessage = aborted ? undefined : `Compaction failed: ${toErrorMessage(error)}`;
      this.clearManualCompactionState();
      this.session.emit({
        aborted,
        errorMessage,
        reason: "manual",
        result: undefined,
        type: "compaction_end",
        willRetry: false,
      });
      yield* performed(
        this.session.compaction.hooks.emitSessionCompactFailed({
          aborted,
          errorMessage,
          fromExtension: outcome.fromExtension,
          reason: "manual",
          willRetry: false,
        }),
      );
    }, this);
  }

  private runDefaultCompaction(
    preparation: compactionTypes.CompactionPreparation,
    model: compatTypes.Model<any>,
    customInstructions: string | undefined,
    signal: AbortSignal,
    reason: "manual" | "threshold" | "overflow",
  ): Effect.Effect<compactionTypes.CompactionResult> {
    return awaitingWith(function* () {
      const request = yield* performed(
        this.session.models.auth.getSummarizationRequestAuth(model, signal),
      );
      return yield* awaited(
        compact(
          preparation,
          request.model,
          request.apiKey,
          request.headers,
          customInstructions,
          signal,
          request.thinkingLevel,
          this.session.agent.streamFunction,
          request.env,
          this.session.settingsManager.session.getRetrySettings(),
          this.session.run.retry.summarizationRetryCallbacks({ reason, source: "compaction" }),
          undefined,
        ),
      );
    }, this);
  }

  performCompaction(
    run: agentSessionInternalTypes.CompactionRun,
  ): Effect.Effect<compactionTypes.CompactionResult> {
    return awaitingWith(function* () {
      if (!run.manual) run.signal.throwIfAborted();
      const extensionCompaction = yield* performed(
        this.session.compaction.hooks.requestExtensionCompaction(run),
      );
      if (!run.manual) run.signal.throwIfAborted();
      const compaction =
        extensionCompaction ??
        (yield* performed(
          this.runDefaultCompaction(
            run.preparation,
            run.model,
            run.customInstructions,
            run.signal,
            run.reason,
          ),
        ));
      if (run.manual && run.signal.aborted) throw new Error("Compaction cancelled");
      if (!run.manual) run.signal.throwIfAborted();
      return yield* performed(this.session.compaction.hooks.commitCompaction(run, compaction));
    }, this);
  }

  private compactManually(
    customInstructions: string | undefined,
    signal: AbortSignal,
    outcome: agentSessionInternalTypes.CompactionOutcome,
  ): Effect.Effect<compactionTypes.CompactionResult> {
    return awaitingWith(function* () {
      const model = this.session.model;
      if (model === undefined) throw new Error(formatNoModelSelectedMessage());
      const settings = this.session.settingsManager.context.getCompactionSettings(model);
      const pathEntries = this.session.sessionManager.getBranch();
      const preparation = prepareCompaction(pathEntries, settings);
      if (preparation === undefined) {
        if (pathEntries.at(-1)?.type === "compaction") throw new Error("Already compacted");
        throw new Error("Nothing to compact (session too small)");
      }
      return yield* performed(
        this.performCompaction({
          customInstructions,
          manual: true,
          model,
          outcome,
          pathEntries,
          preparation,
          reason: "manual",
          signal,
          willRetry: false,
        }),
      );
    }, this);
  }

  compact(customInstructions?: string): Promise<compactionTypes.CompactionResult> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.session.run.lifecycle.abort());
        const controller = new AbortController();
        this.compactionAbortController = controller;
        this.session.emit({ reason: "manual", type: "compaction_start" });
        const outcome = { cancelledByExtension: false, fromExtension: false };
        try {
          const result = yield* performed(
            this.compactManually(customInstructions, controller.signal, outcome),
          );
          this.clearManualCompactionState();
          this.session.emit({
            aborted: false,
            reason: "manual",
            result,
            type: "compaction_end",
            willRetry: false,
          });
          return result;
        } catch (error) {
          yield* performed(this.reportManualCompactionFailure(error, controller.signal, outcome));
          throw error;
        } finally {
          this.clearManualCompactionState();
        }
      }, this),
    );
  }
}
