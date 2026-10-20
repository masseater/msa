import ai from "@msa/ai";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import AgentSessionLayer13 from "./agent-session-layer-13.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import awaitingModule from "./awaiting.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import platform from "./platform.ts";
import settingsManagerSupport from "./settings-manager-support.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { getCurrentSystemMessage, retryDelayMs } = ai;
const { nowMs, sleepFor } = platform;
const { DEFAULT_TOOL_NAMES, applyToolModifiers } = settingsManagerSupport;
const { modelsAreEqual } = compat;

export default abstract class AgentSessionLayer14 extends AgentSessionLayer13 {
  protected dispatchTurnEndBoundary(
    message: compatTypes.AssistantMessage,
    toolResults: compatTypes.ToolResultMessage[],
  ): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      this.lastActivityOutcome =
        message.stopReason === "aborted"
          ? "aborted"
          : message.stopReason === "error"
            ? "error"
            : "completed";
      const messageEntryId = this.findPersistedMessageEntryId(message);
      if (!this.extensionRunnerInternal.hasHandlers("turn_end")) return false;
      if (messageEntryId === undefined || messageEntryId === "") {
        this.extensionRunnerInternal.emitError({
          error: "turn_end could not resolve the persisted assistant entry ID",
          event: "turn_end",
          extensionPath: "<boundary>",
        });
        return false;
      }
      const toolResultEntryIds = toolResults.flatMap((result) => {
        const entryId = this.findPersistedMessageEntryId(result);
        return entryId !== undefined && entryId !== "" ? [entryId] : [];
      });
      const boundary = yield* awaited(
        this.extensionRunnerInternal.emitBoundary(
          {
            message,
            messageEntryId,
            outcome: this.lastActivityOutcome,
            toolResultEntryIds,
            toolResults,
            turnIndex: this.turnIndex,
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

  protected installAgentBoundaryHooks(): void {
    const previousFinishTurn = this.agent.finishTurn;
    this.agent.finishTurn = (turn, signal) =>
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

  protected installAgentForcedPromptProjection(): void {
    const previousTransformContext = this.agent.transformContext;
    this.agent.transformContext = (messages, signal) =>
      Effect.runPromise(
        awaitingWith(function* () {
          const transformed =
            previousTransformContext === undefined
              ? messages
              : yield* awaited(previousTransformContext(messages, signal));
          const forced = this.runSystemPromptOptions?.forceSystemPrompt;
          if (forced === undefined) return transformed;
          const current = getCurrentSystemMessage(transformed);
          const head: compatTypes.SystemMessage = {
            content: forced,
            role: "system",
            timestamp: current?.timestamp ?? nowMs(),
            ...(current?.toolsAdded === undefined ? {} : { toolsAdded: current.toolsAdded }),
          };
          return [head, ...transformed.filter((message) => message.role !== "system")];
        }, this),
      );
  }

  protected restoreToolsFromTranscript(modifiers: readonly string[] = []): void {
    this.pendingToolNames.clear();
    const current = getCurrentSystemMessage(this.sessionManager.buildSessionContext().messages);
    if (current === undefined) return;
    const names = applyToolModifiers(
      (current.toolsAdded ?? []).map((tool) => tool.name),
      modifiers,
    );
    this.pendingToolNames = new Set(names.filter((name) => this.isAllowedTool(name)));
    this.setActiveTools(names);
  }

  protected settleRun(): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (this.agentRunAbortRequested) this.finishCancelledRetry();
      this.failedResponse = undefined;
      this.runSystemPromptOptions = undefined;
      this.endAskRun();
      this.flushPendingBashMessages();
      this.flushPendingCustomMessages();
      yield* performed(this.emitAgentSettled());
    }, this);
  }

  protected runInputHandlers(
    text: string,
    images: compatTypes.ImageContent[] | undefined,
    source: extensionsTypes.InputSource,
    streamingBehavior?: "steer" | "followUp",
  ): Effect.Effect<{ text: string; images: compatTypes.ImageContent[] | undefined } | undefined> {
    return awaitingWith(function* () {
      if (!this.extensionRunnerInternal.hasHandlers("input")) {
        return { images, text };
      }

      const inputResult = yield* awaited(
        this.extensionRunnerInternal.emitInput(text, images, source, streamingBehavior),
      );
      if (inputResult.action === "handled") {
        return undefined;
      }
      if (inputResult.action === "transform") {
        return { images: inputResult.images ?? images, text: inputResult.text };
      }
      return { images, text };
    }, this);
  }

  protected emitModelSelect(
    nextModel: compatTypes.Model<any>,
    previousModel: compatTypes.Model<any> | undefined,
    source: "set" | "cycle" | "restore",
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (modelsAreEqual(previousModel, nextModel)) return;
      yield* awaited(
        this.extensionRunnerInternal.emit({
          model: nextModel,
          previousModel,
          source,
          type: "model_select",
        }),
      );
    }, this);
  }

  setModel(
    model: compatTypes.Model<any>,
    options: agentSessionTypes.ModelMutationOptions = {},
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if ((yield* awaited(this.modelRuntimeInternal.checkAuth(model.provider))) === undefined) {
          throw new Error(`No API key for ${model.provider}/${model.id}`);
        }

        const previousModel = this.model;
        const thinkingLevel = this.getThinkingLevelForModelSwitch(model);
        this.agent.state.model = model;
        this.sessionManager.appendModelChange(model.provider, model.id);
        if (options.persist === true) {
          this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
          this.addPersistedDefaultToNonEmptyScope(model);
        }

        this.setThinkingLevel(thinkingLevel);

        yield* performed(this.emitModelSelect(model, previousModel, "set"));
      }, this),
    );
  }

  refreshExternalServiceTools(): void {
    if (this.baseToolsOverride !== undefined) return;
    const names = this.addExternalServiceTools();
    const defaultTools = this.usesDefaultTools
      ? applyToolModifiers(
          this.settingsManager.getDefaultTools() ?? DEFAULT_TOOL_NAMES,
          this.defaultToolModifiers,
        )
      : [];
    this.refreshToolRegistry({
      activeToolNames: [
        ...this.getActiveToolNames(),
        ...names.filter((name) => defaultTools.includes(name)),
      ],
    });
  }

  protected prepareRetry(message: compatTypes.AssistantMessage): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const settings = this.settingsManager.getRetrySettings();
      if (!settings.enabled) {
        return false;
      }

      this.retryAttemptInternal++;

      if (this.retryAttemptInternal > settings.maxRetries) {
        this.retryAttemptInternal--;
        return false;
      }

      const delayMs = retryDelayMs(settings, this.retryAttemptInternal);

      this.emit({
        attempt: this.retryAttemptInternal,
        delayMs,
        errorMessage: message.errorMessage || "Unknown error",
        maxAttempts: settings.maxRetries,
        type: "auto_retry_start",
      });

      this.omitRecoveryAttempt(message);

      this.retryAbortController = new AbortController();
      try {
        yield* performed(sleepFor(delayMs, this.retryAbortController.signal));
      } catch {
        this.finishCancelledRetry();
        return false;
      } finally {
        this.retryAbortController = undefined;
      }

      return true;
    }, this);
  }
}
