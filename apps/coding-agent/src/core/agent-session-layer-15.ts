import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import errors from "../utils/errors.ts";
import imageProcess from "../utils/image-process.ts";
import type agentSessionInternalTypes from "./agent-session-internal.types.ts";
import AgentSessionLayer14 from "./agent-session-layer-14.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import awaitingModule from "./awaiting.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { processImage } = imageProcess;
const { modelsAreEqual } = compat;
const { toErrorMessage } = errors;

export default abstract class AgentSessionLayer15 extends AgentSessionLayer14 {
  protected handleAgentEvent(event: agentTypes.AgentEvent): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (event.type === "agent_start" && this.agentRunAbortRequested) this.agent.abort();
        this.attachNestedCalls(event);
        if (event.type === "tool_execution_start") this.goalInternal.noteToolUse();
        if (event.type === "message_start" && event.message.role === "user")
          this.dequeueDeliveredUserMessage(event.message);
        yield* awaited(this.emitExtensionEvent(event));
        this.emit(
          event.type === "agent_end"
            ? { ...event, willRetry: this.willRetryAfterAgentEnd(event) }
            : event,
        );
        if (event.type === "message_end") this.persistMessage(event.message);
        if (event.type === "turn_end") {
          this.lastAssistantToolResults = event.toolResults;
          this.flushPendingCustomMessages();
        }
      }, this),
    );
  }

  protected emitExtensionEvent(event: agentTypes.AgentEvent): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (event.type === "agent_start") {
          this.turnIndex = 0;
          yield* awaited(this.extensionRunnerInternal.emit({ type: "agent_start" }));
          return;
        }
        if (event.type === "turn_end") {
          if (
            event.message.role === "assistant" &&
            !this.boundaryDispatchedMessages.delete(event.message)
          )
            yield* performed(this.dispatchTurnEndBoundary(event.message, event.toolResults));
          this.turnIndex++;
          return;
        }
        if (event.type === "message_end") {
          yield* performed(this.applyMessageEndReplacement(event.message));
          return;
        }
        const forwarded = this.forwardedExtensionEvent(event);
        if (forwarded !== undefined) yield* awaited(this.extensionRunnerInternal.emit(forwarded));
      }, this),
    );
  }

  protected normalizePromptImages(
    images: compatTypes.ImageContent[] | undefined,
  ): Effect.Effect<{ images: compatTypes.ImageContent[]; hints: string[] }> {
    return awaitingWith(function* () {
      if (images === undefined) return { hints: [], images: [] };

      const normalizedImages: compatTypes.ImageContent[] = [];
      const hints: string[] = [];
      for (const image of images) {
        const processed = yield* awaited(
          processImage(Buffer.from(image.data, "base64"), image.mimeType, {
            autoResizeImages: this.settingsManager.getImageAutoResize(),
            resizeOptions: this.limitsModel()?.inputLimits?.images?.resize,
          }),
        );
        if (!processed.ok) {
          hints.push(processed.message);
          continue;
        }
        normalizedImages.push({
          data: processed.data,
          mimeType: processed.mimeType,
          type: "image",
        });
        hints.push(...processed.hints);
      }
      return { hints, images: normalizedImages };
    }, this);
  }

  cycleModel(
    direction: "forward" | "backward" = "forward",
    options: agentSessionTypes.ModelMutationOptions = {},
  ): Promise<agentSessionTypes.ModelCycleResult | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.scopedModelsInternal.length > 0) {
          return yield* performed(this.cycleScopedModel(direction, options));
        }
        return yield* performed(this.cycleAvailableModel(direction, options));
      }, this),
    );
  }

  protected cycleScopedModel(
    direction: "forward" | "backward",
    options: agentSessionTypes.ModelMutationOptions,
  ): Effect.Effect<agentSessionTypes.ModelCycleResult | undefined> {
    return awaitingWith(function* () {
      const availableIds = new Set(
        this.modelRuntimeInternal
          .getAvailableSnapshot()
          .map((model) => `${model.provider}\0${model.id}`),
      );
      const scopedModels = this.scopedModelsInternal.filter((scoped) =>
        availableIds.has(`${scoped.model.provider}\0${scoped.model.id}`),
      );
      if (scopedModels.length <= 1) return undefined;

      const currentModel = this.model;
      let currentIndex = scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));

      if (currentIndex === -1) currentIndex = 0;
      const len = scopedModels.length;
      const nextIndex =
        direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
      const next = scopedModels[nextIndex];
      if (next === undefined) return undefined;
      const thinkingLevel = this.getThinkingLevelForModelSwitch(next.model, next.thinkingLevel);

      this.agent.state.model = next.model;
      this.sessionManager.appendModelChange(next.model.provider, next.model.id);
      if (options.persist === true) {
        this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);
        this.addPersistedDefaultToNonEmptyScope(next.model);
      }

      this.setThinkingLevel(thinkingLevel);

      yield* performed(this.emitModelSelect(next.model, currentModel, "cycle"));

      return { isScoped: true, model: next.model, thinkingLevel: this.thinkingLevel };
    }, this);
  }

  protected cycleAvailableModel(
    direction: "forward" | "backward",
    options: agentSessionTypes.ModelMutationOptions,
  ): Effect.Effect<agentSessionTypes.ModelCycleResult | undefined> {
    return awaitingWith(function* () {
      const availableModels = this.modelRuntimeInternal.getAvailableSnapshot();
      if (availableModels.length <= 1) return undefined;

      const currentModel = this.model;
      let currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));

      if (currentIndex === -1) currentIndex = 0;
      const len = availableModels.length;
      const nextIndex =
        direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
      const nextModel = availableModels[nextIndex];
      if (nextModel === undefined) return undefined;

      const thinkingLevel = this.getThinkingLevelForModelSwitch(nextModel);
      this.agent.state.model = nextModel;
      this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
      if (options.persist === true) {
        this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);
        this.addPersistedDefaultToNonEmptyScope(nextModel);
      }

      this.setThinkingLevel(thinkingLevel);

      yield* performed(this.emitModelSelect(nextModel, currentModel, "cycle"));

      return { isScoped: false, model: nextModel, thinkingLevel: this.thinkingLevel };
    }, this);
  }

  protected reportManualCompactionFailure(
    error: unknown,
    signal: AbortSignal,
    outcome: agentSessionInternalTypes.CompactionOutcome,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const aborted = signal.aborted || outcome.cancelledByExtension;
      const errorMessage = aborted ? undefined : `Compaction failed: ${toErrorMessage(error)}`;
      this.clearManualCompactionState();
      this.emit({
        aborted,
        errorMessage,
        reason: "manual",
        result: undefined,
        type: "compaction_end",
        willRetry: false,
      });
      yield* performed(
        this.emitSessionCompactFailed({
          aborted,
          errorMessage,
          fromExtension: outcome.fromExtension,
          reason: "manual",
          willRetry: false,
        }),
      );
    }, this);
  }
}
