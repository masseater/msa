import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import AgentSessionLayer8 from "./agent-session-layer-8.ts";
import ask from "./ask.ts";
import awaitingModule from "./awaiting.ts";
import modelResolver from "./model-resolver.ts";
import platform from "./platform.ts";
import type platformTypes from "./platform.types.ts";
import systemPromptModule from "./system-prompt.ts";
import type systemPromptTypes from "./system-prompt.types.ts";

const { nowMs, schedule } = platform;
const { ASK_SECTION_NAME, ASK_SECTION_TEXT } = ask;
const { normalizeBuildSystemPromptOptions } = systemPromptModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const { resolveModelReference } = modelResolver;

export default abstract class AgentSessionLayer9 extends AgentSessionLayer8 {
  protected watchOrchestratorChanges(): void {
    let orchestratorChangePending: platformTypes.Scheduled | undefined;
    this.orchestratorInternal?.onChange(() => {
      orchestratorChangePending ??= schedule(() => {
        orchestratorChangePending = undefined;
        this.emit({ type: "orchestrator_changed" });
      }, 100);
    });
  }

  protected applyAskPrompt(options: systemPromptTypes.NormalizedBuildSystemPromptOptions): void {
    options.sections[ASK_SECTION_NAME] = ASK_SECTION_TEXT;
    if (options.forceSystemPrompt !== undefined) {
      options.forceSystemPrompt = `${options.forceSystemPrompt}\n\n${ASK_SECTION_TEXT}`;
    }
    for (const [name, { definition }] of this.askVariants) {
      options.toolSnippets[name] = this.normalizePromptSnippet(definition.promptSnippet) ?? "";
      options.toolGuidelines[name] = this.normalizePromptGuidelines(definition.promptGuidelines);
    }
  }

  protected nextTurnPromptOptions(): systemPromptTypes.NormalizedBuildSystemPromptOptions {
    const runOptions = this.runSystemPromptOptions ?? this.baseSystemPromptOptions;
    return normalizeBuildSystemPromptOptions({
      ...runOptions,
      selectedTools: this.getActiveToolNames(),
      toolGuidelines: {
        ...this.baseSystemPromptOptions.toolGuidelines,
        ...runOptions.toolGuidelines,
      },
      toolSnippets: { ...this.baseSystemPromptOptions.toolSnippets, ...runOptions.toolSnippets },
    });
  }

  protected installHiddenDeclarationsProjection(): void {
    const previousTransformContext = this.agent.transformContext;
    this.agent.transformContext = (messages, signal) =>
      Effect.runPromise(
        awaitingWith(function* () {
          const transformed =
            previousTransformContext === undefined
              ? messages
              : yield* awaited(previousTransformContext(messages, signal));
          const hidden = this.hiddenDeclarations;
          if (hidden.size === 0) return transformed;
          return transformed.map((message) => {
            if (
              message.role !== "system" ||
              (message.toolsAdded === undefined && message.toolsRemoved === undefined)
            )
              return message;
            const { toolsAdded, toolsRemoved, ...rest } = message;
            const added = toolsAdded?.filter((tool) => !hidden.has(tool.name)) ?? [];
            const removed = toolsRemoved?.filter((tool) => !hidden.has(tool.name)) ?? [];
            return Object.assign(
              {},
              rest,
              added.length > 0 ? { toolsAdded: added } : {},
              removed.length > 0 ? { toolsRemoved: removed } : {},
            );
          });
        }, this),
      );
  }

  protected queueSteer(text: string, images?: compatTypes.ImageContent[]): Effect.Effect<void> {
    return Effect.sync(() => {
      this.steeringMessages.push(text);
      this.emitQueueUpdate();
      const content: (compatTypes.TextContent | compatTypes.ImageContent)[] = [
        { text, type: "text" },
      ];
      if (images !== undefined) {
        content.push(...images);
      }
      this.agent.steer({
        content,
        role: "user",
        timestamp: nowMs(),
      });
    });
  }

  protected queueFollowUp(text: string, images?: compatTypes.ImageContent[]): Effect.Effect<void> {
    return Effect.sync(() => {
      this.followUpMessages.push(text);
      this.emitQueueUpdate();
      const content: (compatTypes.TextContent | compatTypes.ImageContent)[] = [
        { text, type: "text" },
      ];
      if (images !== undefined) {
        content.push(...images);
      }
      this.agent.followUp({ content, role: "user", timestamp: nowMs() });
    });
  }

  protected resolveOrchestratorModel(reference: string): compatTypes.Model<any> {
    const result = resolveModelReference(
      { fuzzy: false, text: reference, thinkingSuffix: "none" },
      this.modelRuntimeInternal.getAvailableSnapshot(),
      () => true,
    );
    if (result.status === "resolved") return result.model;
    const name = reference.slice(reference.indexOf("/") + 1).toLowerCase();
    const candidates = this.modelRuntimeInternal
      .getAvailableSnapshot()
      .filter((model) => name !== "" && model.id.toLowerCase().includes(name))
      .map((model) => `${model.provider}/${model.id}`);
    throw new Error(
      `"${reference}" is not an available model.${
        candidates.length > 0 ? ` Use one of: ${candidates.join(", ")}` : ""
      }`,
    );
  }

  protected reportAutoCompactionFailure(
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
      this.emit({
        aborted,
        errorMessage,
        reason,
        result: undefined,
        type: "compaction_end",
        willRetry: false,
      });
      yield* performed(
        this.emitSessionCompactFailed({
          aborted,
          errorMessage,
          fromExtension,
          reason,
          willRetry: false,
        }),
      );
    }, this);
  }
}
