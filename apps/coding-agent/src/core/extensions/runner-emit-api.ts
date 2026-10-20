import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import type cacheWarmerTypes from "../cache-warmer.types.ts";
import platform from "../platform/index.ts";
import type systemPromptTypes from "../system-prompt.types.ts";
import runnerEmitters from "./runner-emitters.ts";
import type runnerEmittersTypes from "./runner-emitters.types.ts";
import RunnerQueries from "./runner-queries.ts";
import type runnerTypesTypes from "./runner-types.ts";
import type extensionsTypesTypes from "./types.types.ts";
const { createEmitters } = runnerEmitters;
const { unwrapForeign } = platform;

export default abstract class RunnerEmitApi extends RunnerQueries {
  private cachedEmitters: runnerEmittersTypes.Emitters | undefined;

  abstract createContext(): extensionsTypesTypes.ExtensionContext;
  abstract emitError(error: extensionsTypesTypes.ExtensionError): void;
  protected abstract assertActive(): void;

  emitBoundary(
    baseEvent: runnerTypesTypes.BoundaryBaseEvent,
    buildContext: (
      entries: extensionsTypesTypes.SessionBoundaryDraft[],
    ) =>
      | extensionsTypesTypes.BoundaryContextPreview
      | Promise<extensionsTypesTypes.BoundaryContextPreview>,
  ) {
    return this.run(this.emitters().lifecycle.emitBoundary(baseEvent, buildContext));
  }

  emit<TEvent extends runnerTypesTypes.RunnerEmitEvent>(event: TEvent) {
    return this.run(this.emitters().lifecycle.emit(event));
  }

  emitCacheWarmingDecision(
    event: extensionsTypesTypes.CacheWarmingDecisionEvent,
  ): Promise<cacheWarmerTypes.CacheWarmingAction> {
    return this.run(this.emitters().lifecycle.emitCacheWarmingDecision(event));
  }

  emitMessageEnd(
    event: extensionsTypesTypes.MessageEndEvent,
  ): Promise<agentTypes.AgentMessage | undefined> {
    return this.run(this.emitters().lifecycle.emitMessageEnd(event));
  }

  emitToolResult(event: extensionsTypesTypes.ToolResultEvent) {
    return this.run(this.emitters().lifecycle.emitToolResult(event));
  }

  emitToolCall(event: extensionsTypesTypes.ToolCallEvent) {
    return this.run(this.emitters().lifecycle.emitToolCall(event));
  }

  emitUserBash(event: extensionsTypesTypes.UserBashEvent) {
    return this.run(this.emitters().lifecycle.emitUserBash(event));
  }

  emitContext(messages: agentTypes.AgentMessage[]): Promise<agentTypes.AgentMessage[]> {
    return this.run(this.emitters().context.emitContext(messages));
  }

  emitBeforeProviderRequest(payload: unknown): Promise<unknown> {
    return this.run(this.emitters().context.emitBeforeProviderRequest(payload));
  }

  emitBeforeProviderHeaders(headers: aiTypes.ProviderHeaders): Promise<aiTypes.ProviderHeaders> {
    return this.run(this.emitters().context.emitBeforeProviderHeaders(headers));
  }

  emitBeforeAgentStart(
    trigger: runnerTypesTypes.BeforeAgentStartTrigger,
    options: systemPromptTypes.BuildSystemPromptOptions,
  ) {
    return this.run(this.emitters().context.emitBeforeAgentStart(trigger, options));
  }

  emitResourcesDiscover(
    cwd: string,
    reason: extensionsTypesTypes.ResourcesDiscoverEvent["reason"],
  ) {
    return this.run(this.emitters().context.emitResourcesDiscover(cwd, reason));
  }

  emitInput(
    text: string,
    images: aiTypes.ImageContent[] | undefined,
    source: extensionsTypesTypes.InputSource,
    streamingBehavior?: "steer" | "followUp",
  ) {
    return this.run(this.emitters().context.emitInput(text, images, source, streamingBehavior));
  }

  private emitters(): runnerEmittersTypes.Emitters {
    this.cachedEmitters ??= createEmitters({
      assertActive: () => this.assertActive(),
      createContext: () => this.createContext(),
      emitError: (error) => this.emitError(error),
      extensions: this.extensions,
    });
    return this.cachedEmitters;
  }

  private run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    return Effect.runPromise(unwrapForeign(effect));
  }
}
