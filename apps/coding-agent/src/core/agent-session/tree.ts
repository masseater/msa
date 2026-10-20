import ai from "@msa/ai";
import * as Effect from "effect/Effect";

import type agentSessionInternalTypes from "../agent-session-internal.types.ts";
import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import compactionModule from "../compaction/index.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";

const { contentText } = ai;
const { awaited, awaitingWith, performed } = awaitingModule;
const { generateBranchSummary, collectEntriesForBranchSummary } = compactionModule;

export default class SessionTree {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  branchSummaryAbortController: AbortController | undefined = undefined;

  abortBranchSummary(): void {
    this.branchSummaryAbortController?.abort();
  }

  private assertTreeNavigable(): void {
    if (this.session.isStreaming) {
      throw new Error(
        "Wait for the current response to finish before navigating the session tree.",
      );
    }
    if (this.session.compaction.manual.isCompacting) {
      throw new Error(
        "Wait for the current compaction or tree navigation to finish before navigating the session tree.",
      );
    }
  }

  private treeExtensionOverrides(
    preparation: extensionsTypes.TreePreparation,
    signal: AbortSignal,
    summarize: boolean,
  ) {
    return awaitingWith(function* () {
      const instructions: agentSessionInternalTypes.TreeInstructions = {
        customInstructions: preparation.customInstructions,
        label: preparation.label,
        replaceInstructions: preparation.replaceInstructions,
      };
      if (
        !this.session.extensions.binding.extensionRunnerInternal.hasHandlers("session_before_tree")
      )
        return { cancelled: false, extensionSummary: undefined, instructions };
      const result = (yield* awaited(
        this.session.extensions.binding.extensionRunnerInternal.emit({
          preparation,
          signal,
          type: "session_before_tree",
        }),
      )) as extensionsTypes.SessionBeforeTreeResult | undefined;
      if (result?.cancel === true)
        return { cancelled: true, extensionSummary: undefined, instructions };
      if (result?.customInstructions !== undefined)
        instructions.customInstructions = result.customInstructions;
      if (result?.replaceInstructions !== undefined)
        instructions.replaceInstructions = result.replaceInstructions;
      if (result?.label !== undefined) instructions.label = result.label;
      const extensionSummary = summarize ? result?.summary : undefined;
      return { cancelled: false, extensionSummary, instructions };
    }, this);
  }

  private moveToTreeTarget(
    targetEntry: sessionManagerTypes.SessionEntry,
    summary: agentSessionInternalTypes.TreeSummary,
    label: string | undefined,
  ) {
    let newLeafId: string | null = targetEntry.id;
    let editorText: string | undefined;
    if (targetEntry.type === "message" && targetEntry.message.role === "user") {
      newLeafId = targetEntry.parentId;
      editorText = contentText(targetEntry.message.content, "");
    } else if (targetEntry.type === "custom_message") {
      newLeafId = targetEntry.parentId;
      editorText = contentText(targetEntry.content, "");
    }
    const hasLabel = label !== undefined && label !== "";
    if (summary.text === undefined || summary.text === "") {
      if (newLeafId === null) this.session.sessionManager.resetLeaf();
      else this.session.sessionManager.branch(newLeafId);
      if (hasLabel) this.session.sessionManager.appendLabelChange(targetEntry.id, label);
      return { editorText, summaryEntry: undefined };
    }
    const summaryId = this.session.sessionManager.branchWithSummary(
      newLeafId,
      summary.text,
      summary.details,
      summary.fromExtension,
      summary.usage,
    );
    const summaryEntry = this.session.sessionManager.getEntry(
      summaryId,
    ) as sessionManagerTypes.BranchSummaryEntry;
    if (hasLabel) this.session.sessionManager.appendLabelChange(summaryId, label);
    return { editorText, summaryEntry };
  }

  private summarizeBranch(
    entries: extensionsTypes.TreePreparation["entriesToSummarize"],
    instructions: agentSessionInternalTypes.TreeInstructions,
    signal: AbortSignal,
  ): Effect.Effect<agentSessionInternalTypes.TreeSummary | "aborted"> {
    return awaitingWith(function* () {
      const branchSummarySettings = this.session.settingsManager.getBranchSummarySettings();
      const result = yield* awaited(
        generateBranchSummary(entries, {
          ...(yield* performed(
            this.session.models.auth.getSummarizationRequestAuth(this.session.model!, signal),
          )),
          callbacks: this.session.run.retry.summarizationRetryCallbacks({
            source: "branchSummary",
          }),
          customInstructions: instructions.customInstructions,
          replaceInstructions: instructions.replaceInstructions,
          reserveTokens: branchSummarySettings.reserveTokens,
          retry: this.session.settingsManager.getRetrySettings(),
          signal,
          streamFn: this.session.agent.streamFunction,
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

  private navigateTreeTo(
    targetEntry: sessionManagerTypes.SessionEntry,
    preparation: extensionsTypes.TreePreparation,
    signal: AbortSignal,
  ) {
    return awaitingWith(function* () {
      const summarize = preparation.userWantsSummary;
      const overrides = yield* performed(
        this.treeExtensionOverrides(preparation, signal, summarize),
      );
      if (overrides.cancelled) return { cancelled: true };
      const { extensionSummary, instructions } = overrides;
      let summary: agentSessionInternalTypes.TreeSummary = {
        details: extensionSummary?.details,
        fromExtension: extensionSummary !== undefined,
        text: extensionSummary?.summary,
        usage: extensionSummary?.usage,
      };
      if (
        summarize &&
        preparation.entriesToSummarize.length > 0 &&
        extensionSummary === undefined
      ) {
        const generated = yield* performed(
          this.summarizeBranch(preparation.entriesToSummarize, instructions, signal),
        );
        if (generated === "aborted") return { aborted: true, cancelled: true };
        summary = generated;
      }
      const moved = this.moveToTreeTarget(targetEntry, summary, instructions.label);
      this.session.context.transcript.refreshFinalizedContext();
      this.session.tools.loadout.restoreToolsFromTranscript();
      const summarized = summary.text !== undefined && summary.text !== "";
      yield* awaited(
        this.session.extensions.binding.extensionRunnerInternal.emit({
          fromExtension: summarized ? summary.fromExtension : undefined,
          newLeafId: this.session.sessionManager.getLeafId(),
          oldLeafId: preparation.oldLeafId,
          summaryEntry: moved.summaryEntry,
          type: "session_tree",
        }),
      );
      return { cancelled: false, editorText: moved.editorText, summaryEntry: moved.summaryEntry };
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
        const oldLeafId = this.session.sessionManager.getLeafId();
        if (targetId === oldLeafId) return { cancelled: false };
        if (options.summarize === true && this.session.model === undefined)
          throw new Error("No model available for summarization");
        const targetEntry = this.session.sessionManager.getEntry(targetId);
        if (targetEntry === undefined) throw new Error(`Entry ${targetId} not found`);
        const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
          this.session.sessionManager,
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
          this.session.run.lifecycle.resolveIdleWaitIfIdle();
        }
      }, this),
    );
  }
}
