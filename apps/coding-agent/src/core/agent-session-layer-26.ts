import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type agentSessionInternalTypes from "./agent-session-internal.types.ts";
import AgentSessionLayer25 from "./agent-session-layer-25.ts";
import authGuidance from "./auth-guidance.ts";
import awaitingModule from "./awaiting.ts";
import bugReport from "./bug-report.ts";
import compactionModule from "./compaction/index.ts";
import type compactionTypes from "./compaction/index.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { compact, generateBranchSummary, prepareCompaction } = compactionModule;
const { formatNoModelSelectedMessage } = authGuidance;
const { generateBugReportSummary } = bugReport;

export default abstract class AgentSessionLayer26 extends AgentSessionLayer25 {
  protected runDefaultCompaction(
    preparation: compactionTypes.CompactionPreparation,
    model: compatTypes.Model<any>,
    customInstructions: string | undefined,
    signal: AbortSignal,
    reason: "manual" | "threshold" | "overflow",
  ): Effect.Effect<compactionTypes.CompactionResult> {
    return awaitingWith(function* () {
      const request = yield* performed(this.getSummarizationRequestAuth(model, signal));
      return yield* awaited(
        compact(
          preparation,
          request.model,
          request.apiKey,
          request.headers,
          customInstructions,
          signal,
          request.thinkingLevel,
          this.agent.streamFunction,
          request.env,
          this.settingsManager.getRetrySettings(),
          this.summarizationRetryCallbacks({ reason, source: "compaction" }),
          undefined,
        ),
      );
    }, this);
  }

  protected performCompaction(
    run: agentSessionInternalTypes.CompactionRun,
  ): Effect.Effect<compactionTypes.CompactionResult> {
    return awaitingWith(function* () {
      if (!run.manual) run.signal.throwIfAborted();
      const extensionCompaction = yield* performed(this.requestExtensionCompaction(run));
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
      return yield* performed(this.commitCompaction(run, compaction));
    }, this);
  }

  protected compactManually(
    customInstructions: string | undefined,
    signal: AbortSignal,
    outcome: agentSessionInternalTypes.CompactionOutcome,
  ): Effect.Effect<compactionTypes.CompactionResult> {
    return awaitingWith(function* () {
      const model = this.model;
      if (model === undefined) throw new Error(formatNoModelSelectedMessage());
      const settings = this.settingsManager.getCompactionSettings(model);
      const pathEntries = this.sessionManager.getBranch();
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
        yield* awaited(this.abort());
        const controller = new AbortController();
        this.compactionAbortController = controller;
        this.emit({ reason: "manual", type: "compaction_start" });
        const outcome = { cancelledByExtension: false, fromExtension: false };
        try {
          const result = yield* performed(
            this.compactManually(customInstructions, controller.signal, outcome),
          );
          this.clearManualCompactionState();
          this.emit({
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

  protected runAutoCompaction(
    reason: "overflow" | "threshold",
    willRetry: boolean,
  ): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const model = this.model;
        const settings = this.settingsManager.getCompactionSettings(model);
        const outcome = { cancelledByExtension: false, fromExtension: false };
        let abortController: AbortController | undefined;
        try {
          if (model === undefined) return false;
          const pathEntries = this.sessionManager.getBranch();
          const preparation = prepareCompaction(pathEntries, settings);
          if (preparation === undefined) return false;
          abortController = new AbortController();
          this.autoCompactionAbortController = abortController;
          this.emit({ reason, type: "compaction_start" });
          const result = yield* performed(
            this.performCompaction({
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
          this.emit({ aborted: false, reason, result, type: "compaction_end", willRetry });
          return willRetry || this.agent.hasQueuedMessages();
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
          this.resolveIdleWaitIfIdle();
        }
      }, this),
    );
  }

  protected summarizeBranch(
    entries: extensionsTypes.TreePreparation["entriesToSummarize"],
    instructions: agentSessionInternalTypes.TreeInstructions,
    signal: AbortSignal,
  ): Effect.Effect<agentSessionInternalTypes.TreeSummary | "aborted"> {
    return awaitingWith(function* () {
      const branchSummarySettings = this.settingsManager.getBranchSummarySettings();
      const result = yield* awaited(
        generateBranchSummary(entries, {
          ...(yield* performed(this.getSummarizationRequestAuth(this.model!, signal))),
          callbacks: this.summarizationRetryCallbacks({ source: "branchSummary" }),
          customInstructions: instructions.customInstructions,
          replaceInstructions: instructions.replaceInstructions,
          reserveTokens: branchSummarySettings.reserveTokens,
          retry: this.settingsManager.getRetrySettings(),
          signal,
          streamFn: this.agent.streamFunction,
        }),
      );
      if (result.aborted === true) return "aborted" as const;
      if (result.error !== undefined && result.error !== "") throw new Error(result.error);
      return {
        details: { modifiedFiles: result.modifiedFiles ?? [], readFiles: result.readFiles ?? [] },
        fromExtension: false,
        text: result.summary,
        usage: result.usage,
      };
    }, this);
  }

  summarizeForBugReport(options: {
    hint?: string | undefined;
    signal: AbortSignal;
  }): Promise<string> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const model = this.model;
        if (model === undefined) {
          throw new Error("No model selected");
        }
        return yield* awaited(
          generateBugReportSummary({
            ...(yield* performed(this.getSummarizationRequestAuth(model, options.signal))),
            hint: options.hint,
            messages: this.messages,
            retry: this.settingsManager.getRetrySettings(),
            sessionId: this.sessionId,
            signal: options.signal,
            streamFn: this.agent.streamFunction,
          }),
        );
      }, this),
    );
  }
}
