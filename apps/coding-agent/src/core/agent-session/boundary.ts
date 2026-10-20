import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import compactionModule from "../compaction/index.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import messagesModule from "../messages.ts";
import SessionManager from "../session-manager.ts";
import type sessionManagerTypes from "../session-manager.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { estimateProjectedContextTokens } = compactionModule;
const { convertToLlm } = messagesModule;

export default class SessionBoundary {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  readonly boundaryDispatchedMessages = new WeakSet<object>();

  private getPendingBoundaryMessages(): agentTypes.AgentMessage[] {
    return [
      ...this.session.agent.peekQueuedMessages(),
      ...this.session.run.prompting.pendingCustomMessages,
    ];
  }

  private reportInvalidBoundaryContinuation(event: "turn_end" | "agent_before_settle"): void {
    this.session.extensions.binding.extensionRunnerInternal.emitError({
      error: `${event} requested continuation without runnable model context`,
      event,
      extensionPath: "<boundary>",
    });
  }

  private applyBoundaryDrafts(
    manager: sessionManagerTypes.SessionManager,
    drafts: extensionsTypes.SessionBoundaryDraft[],
  ): sessionManagerTypes.SessionEntry[] {
    const appended: sessionManagerTypes.SessionEntry[] = [];
    for (const draft of drafts) {
      let entryId: string;
      switch (draft.type) {
        case "custom":
          entryId = manager.appendCustomEntry(draft.customType, draft.data);
          break;
        case "custom_message":
          entryId = manager.appendCustomMessageEntry(
            draft.customType,
            draft.content,
            draft.display,
            draft.details,
          );
          break;
        case "context_edit":
          entryId = manager.appendContextEdit(draft.targetId, draft.replacement);
          break;
        case "compaction": {
          const tokensBefore = estimateProjectedContextTokens(
            manager.buildSessionProjection(),
            manager.getBranch(),
          ).tokens;
          entryId = manager.appendCompaction(
            draft.summary,
            draft.firstKeptEntryId,
            tokensBefore,
            draft.details,
            true,
            draft.usage,
          );
          break;
        }
      }
      const entry = manager.getEntry(entryId);
      if (entry !== undefined) appended.push(entry);
    }
    return appended;
  }

  private createBoundaryPreviewManager(
    drafts: extensionsTypes.SessionBoundaryDraft[],
  ): sessionManagerTypes.SessionManager {
    const header = this.session.sessionManager.getHeader();
    if (header === null) throw new Error("Session header is missing");
    const manager = SessionManager.inMemory(this.session.cwd, undefined, [
      header,
      ...this.session.sessionManager.getBranch(),
    ]);
    this.applyBoundaryDrafts(manager, drafts);
    return manager;
  }

  private buildBoundaryContext(
    drafts: extensionsTypes.SessionBoundaryDraft[],
    boundary: "turn_end" | "agent_before_settle",
  ): extensionsTypes.BoundaryContextPreview {
    const projection = this.createBoundaryPreviewManager(drafts).buildSessionProjection();
    const pendingMessages = this.getPendingBoundaryMessages();
    const llmMessages = convertToLlm(projection.messages);
    const finalRole = llmMessages[llmMessages.length - 1]?.role;
    const hasNonSystemContext = llmMessages.some((message) => message.role !== "system");
    const contextCanContinue = hasNonSystemContext && finalRole !== "assistant";
    const pendingCustomContext = this.session.run.prompting.pendingCustomMessages.length > 0;
    return {
      canContinue:
        contextCanContinue ||
        pendingCustomContext ||
        (boundary === "turn_end"
          ? this.session.agent.hasQueuedMessages()
          : finalRole === "assistant" && this.session.agent.hasQueuedMessages()),
      contextEntries: projection.entries,
      contextMessages: projection.messages,
      llmMessages,
      pendingMessages,
    };
  }

  private commitBoundaryDrafts(drafts: extensionsTypes.SessionBoundaryDraft[]): void {
    const appended = this.applyBoundaryDrafts(this.session.sessionManager, drafts);
    this.session.context.transcript.refreshFinalizedContext();
    for (const entry of appended) this.session.emit({ entry, type: "entry_appended" });
  }

  runBeforeSettleBoundary(): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      if (
        !this.session.extensions.binding.extensionRunnerInternal.hasHandlers("agent_before_settle")
      )
        return this.session.agent.hasQueuedMessages();
      this.session.run.lifecycle.isBeforeSettle = true;
      this.session.run.lifecycle.abortDuringBeforeSettle = false;
      try {
        const result = yield* awaited(
          this.session.extensions.binding.extensionRunnerInternal.emitBoundary(
            {
              outcome: this.session.run.lifecycle.lastActivityOutcome,
              type: "agent_before_settle",
            },
            (entries) => this.buildBoundaryContext(entries, "agent_before_settle"),
          ),
        );
        this.commitBoundaryDrafts(result.entries);
        this.session.run.prompting.flushPendingCustomMessages();
        const finalContext = this.buildBoundaryContext([], "agent_before_settle");
        if (this.session.run.lifecycle.abortDuringBeforeSettle) return false;
        const shouldContinue = result.continue || this.session.agent.hasQueuedMessages();
        if (shouldContinue && !finalContext.canContinue) {
          if (result.continue) this.reportInvalidBoundaryContinuation("agent_before_settle");
          return false;
        }
        return shouldContinue;
      } finally {
        this.session.run.lifecycle.isBeforeSettle = false;
      }
    }, this);
  }

  dispatchTurnEndBoundary(
    message: compatTypes.AssistantMessage,
    toolResults: compatTypes.ToolResultMessage[],
  ): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      this.session.run.lifecycle.lastActivityOutcome =
        message.stopReason === "aborted"
          ? "aborted"
          : message.stopReason === "error"
            ? "error"
            : "completed";
      const messageEntryId = this.session.context.transcript.findPersistedMessageEntryId(message);
      if (!this.session.extensions.binding.extensionRunnerInternal.hasHandlers("turn_end"))
        return false;
      if (messageEntryId === undefined || messageEntryId === "") {
        this.session.extensions.binding.extensionRunnerInternal.emitError({
          error: "turn_end could not resolve the persisted assistant entry ID",
          event: "turn_end",
          extensionPath: "<boundary>",
        });
        return false;
      }
      const toolResultEntryIds = toolResults.flatMap((result) => {
        const entryId = this.session.context.transcript.findPersistedMessageEntryId(result);
        return entryId !== undefined && entryId !== "" ? [entryId] : [];
      });
      const boundary = yield* awaited(
        this.session.extensions.binding.extensionRunnerInternal.emitBoundary(
          {
            message,
            messageEntryId,
            outcome: this.session.run.lifecycle.lastActivityOutcome,
            toolResultEntryIds,
            toolResults,
            turnIndex: this.session.extensions.events.turnIndex,
            type: "turn_end",
          },
          (entries) => this.buildBoundaryContext(entries, "turn_end"),
        ),
      );
      this.commitBoundaryDrafts(boundary.entries);
      if (boundary.continue && !this.buildBoundaryContext([], "turn_end").canContinue) {
        this.reportInvalidBoundaryContinuation("turn_end");
        return false;
      }
      return boundary.continue;
    }, this);
  }

  installAgentBoundaryHooks(): void {
    const previousFinishTurn = this.session.agent.finishTurn;
    this.session.agent.finishTurn = (turn, signal) =>
      Effect.runPromise(
        awaitingWith(function* () {
          this.boundaryDispatchedMessages.add(turn.message);
          const extensionContinue = yield* performed(
            this.dispatchTurnEndBoundary(turn.message, turn.toolResults),
          );
          const previousDecision = yield* awaited(previousFinishTurn?.(turn, signal));
          if (previousDecision?.action === "end") return previousDecision;
          if (extensionContinue || previousDecision?.action === "continue")
            return { action: "continue" } as const;
          return undefined;
        }, this),
      );
  }
}
