import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type agentSessionInternalTypes from "./agent-session-internal.types.ts";
import AgentSessionLayer26 from "./agent-session-layer-26.ts";
import awaitingModule from "./awaiting.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import virtualModels from "./virtual-models.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { isVirtualModel } = virtualModels;

export default abstract class AgentSessionLayer27 extends AgentSessionLayer26 {
  protected installAgentHooks(): void {
    this.installAgentToolHooks();
    this.installAgentNextTurnRefresh();
    this.installAgentRequestProjection();
    this.installAgentBoundaryHooks();
    this.installHiddenDeclarationsProjection();
    this.installAgentForcedPromptProjection();
  }

  protected compactBeforeNextAssistantResponse(
    context: agentTypes.AgentContext,
  ): Effect.Effect<agentTypes.AgentContext> {
    return awaitingWith(function* () {
      const projection = this.sessionManager.buildSessionProjection();
      const model = this.model;
      if (
        model === undefined ||
        isVirtualModel(model) ||
        !this.exceedsCompactionThreshold(model, projection)
      ) {
        return { ...context, messages: projection.messages };
      }
      yield* awaited(this.runAutoCompaction("threshold", false));
      return { ...context, messages: this.sessionManager.buildSessionProjection().messages };
    }, this);
  }

  protected installAgentRequestProjection(): void {
    const previousPrepareRequest = this.agent.prepareRequest;
    this.agent.prepareRequest = (request, signal) =>
      Effect.runPromise(this.projectRequest(previousPrepareRequest, request, signal));
  }

  protected projectRequest(
    previousPrepareRequest: agentTypes.Agent["prepareRequest"],
    request: Parameters<NonNullable<agentTypes.Agent["prepareRequest"]>>[0],
    signal: AbortSignal | undefined,
  ) {
    return awaitingWith(function* () {
      const failed = this.failedResponse;
      this.failedResponse = undefined;
      const prepare = () => this.prepareProjectedRequest(previousPrepareRequest, request, signal);
      let { previous, context, projection } = yield* awaited(prepare());
      const model = previous?.model ?? this.agent.state.model;
      const thinkingLevel = previous?.thinkingLevel ?? this.agent.state.thinkingLevel;
      if (!isVirtualModel(model)) return { ...previous, context, model, thinkingLevel };
      const route = yield* performed(
        this.routeVirtualRequest(model, context, { failed, signal, thinkingLevel }),
      );
      if (this.exceedsCompactionThreshold(route.model, projection)) {
        yield* awaited(this.runAutoCompaction("threshold", false));
        ({ previous, context } = yield* awaited(prepare()));
      }
      return { ...previous, context, model: route.model, thinkingLevel: route.thinkingLevel };
    }, this);
  }

  protected installAgentNextTurnRefresh(): void {
    const previousPrepareNextTurnWithContext =
      this.agent.prepareNextTurnWithContext ??
      (this.agent.prepareNextTurn === undefined
        ? undefined
        : (_turn: agentTypes.PrepareNextTurnContext, signal?: AbortSignal) =>
            Effect.runPromise(
              awaitingWith(function* () {
                return yield* awaited(this.agent.prepareNextTurn?.(signal));
              }, this),
            ));
    this.agent.prepareNextTurnWithContext = (turn, signal) =>
      Effect.runPromise(
        awaitingWith(function* () {
          const context = yield* performed(this.compactBeforeNextAssistantResponse(turn.context));
          const previousSnapshot = yield* awaited(
            previousPrepareNextTurnWithContext?.({ ...turn, context }, signal),
          );
          const nextContext = previousSnapshot?.context ?? context;
          const options = this.nextTurnPromptOptions();
          const updateMessage = this.preparePromptAndToolLoadout(options, nextContext.messages);
          this.runSystemPromptOptions = options;

          return {
            ...previousSnapshot,
            context: {
              ...nextContext,
              tools: this.agent.state.tools.slice(),
            },
            ...(updateMessage === undefined
              ? {}
              : { messages: [...(previousSnapshot?.messages ?? []), updateMessage] }),
            model: this.agent.state.model,
            thinkingLevel: this.agent.state.thinkingLevel,
          };
        }, this),
      );
  }

  protected recoverFromOverflow(
    assistantMessage: compatTypes.AssistantMessage,
    toolResults: agentTypes.AgentMessage[],
    contextOverflow: boolean,
  ): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const willRetry = assistantMessage.stopReason !== "stop";
      if (!willRetry) return yield* awaited(this.runAutoCompaction("overflow", false));
      if (this.overflowRecoveryAttempted) {
        const errorMessage = contextOverflow
          ? "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model."
          : "Truncated response recovery failed after one compact-and-retry attempt.";
        this.emit({
          aborted: false,
          errorMessage,
          reason: "overflow",
          result: undefined,
          type: "compaction_end",
          willRetry: false,
        });
        yield* performed(
          this.emitSessionCompactFailed({
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
      this.omitRecoveryAttempt(assistantMessage, toolResults);
      const retry = yield* awaited(this.runAutoCompaction("overflow", willRetry));
      if (retry) this.failedResponse = assistantMessage;
      return retry;
    }, this);
  }

  protected contextActions(): Parameters<extensionsTypes.ExtensionRunner["bindCore"]>[1] {
    return {
      abort: () => {
        if (this.extensionAbortHandler !== undefined) {
          this.extensionAbortHandler();
          return;
        }
        void this.abort();
      },
      compact: (options) => {
        this.compact(options?.customInstructions)
          .then((result) => options?.onComplete?.(result))
          .catch((error: unknown) =>
            options?.onError?.(error instanceof Error ? error : new Error(String(error))),
          );
      },
      executeTool: (callerId, name, args, options) =>
        Effect.runPromise(this.executeNestedToolCall(callerId, name, args, options)),
      getCallableTools: () => this.getCallableTools(),
      getContextUsage: () => this.getContextUsage(),
      getModel: () => this.model,
      getScopedModels: () => this.scopedModelsInternal,
      getSignal: () => this.agent.signal,
      getSystemPrompt: () => this.systemPrompt,
      getSystemPromptOptions: () => this.baseSystemPromptOptions,
      hasPendingMessages: () => this.pendingMessageCount > 0,
      isIdle: () => this.isIdle,
      isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
      shutdown: () => {
        this.extensionShutdownHandler?.();
      },
    };
  }

  protected navigateTreeTo(
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
      this.refreshFinalizedContext();
      this.restoreToolsFromTranscript();
      const summarized = summary.text !== undefined && summary.text !== "";
      yield* awaited(
        this.extensionRunnerInternal.emit({
          fromExtension: summarized ? summary.fromExtension : undefined,
          newLeafId: this.sessionManager.getLeafId(),
          oldLeafId: preparation.oldLeafId,
          summaryEntry: moved.summaryEntry,
          type: "session_tree",
        }),
      );
      return { cancelled: false, editorText: moved.editorText, summaryEntry: moved.summaryEntry };
    }, this);
  }
}
