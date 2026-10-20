import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import type { CacheWarmingAction } from "../cache-warmer.ts";
import { platformRuntime, unwrapForeign } from "../platform/index.ts";
import type { BuildSystemPromptOptions } from "../system-prompt.ts";
import { type Emitters, createEmitters } from "./runner-emitters.ts";
import { RunnerQueries } from "./runner-queries.ts";
import type {
  BeforeAgentStartTrigger,
  BoundaryBaseEvent,
  RunnerEmitEvent,
} from "./runner-types.ts";
import type {
  BoundaryContextPreview,
  CacheWarmingDecisionEvent,
  ExtensionContext,
  ExtensionError,
  InputSource,
  MessageEndEvent,
  ResourcesDiscoverEvent,
  SessionBoundaryDraft,
  ToolCallEvent,
  ToolResultEvent,
  UserBashEvent,
} from "./types.ts";

export abstract class RunnerEmitApi extends RunnerQueries {
  private cachedEmitters: Emitters | undefined;

  abstract createContext(): ExtensionContext;
  abstract emitError(error: ExtensionError): void;
  protected abstract assertActive(): void;

  emitBoundary(
    baseEvent: BoundaryBaseEvent,
    buildContext: (
      entries: SessionBoundaryDraft[],
    ) => BoundaryContextPreview | Promise<BoundaryContextPreview>,
  ) {
    return this.run(this.emitters().lifecycle.emitBoundary(baseEvent, buildContext));
  }

  emit<TEvent extends RunnerEmitEvent>(event: TEvent) {
    return this.run(this.emitters().lifecycle.emit(event));
  }

  emitCacheWarmingDecision(event: CacheWarmingDecisionEvent): Promise<CacheWarmingAction> {
    return this.run(this.emitters().lifecycle.emitCacheWarmingDecision(event));
  }

  emitMessageEnd(event: MessageEndEvent): Promise<agentTypes.AgentMessage | undefined> {
    return this.run(this.emitters().lifecycle.emitMessageEnd(event));
  }

  emitToolResult(event: ToolResultEvent) {
    return this.run(this.emitters().lifecycle.emitToolResult(event));
  }

  emitToolCall(event: ToolCallEvent) {
    return this.run(this.emitters().lifecycle.emitToolCall(event));
  }

  emitUserBash(event: UserBashEvent) {
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

  emitBeforeAgentStart(trigger: BeforeAgentStartTrigger, options: BuildSystemPromptOptions) {
    return this.run(this.emitters().context.emitBeforeAgentStart(trigger, options));
  }

  emitResourcesDiscover(cwd: string, reason: ResourcesDiscoverEvent["reason"]) {
    return this.run(this.emitters().context.emitResourcesDiscover(cwd, reason));
  }

  emitInput(
    text: string,
    images: aiTypes.ImageContent[] | undefined,
    source: InputSource,
    streamingBehavior?: "steer" | "followUp",
  ) {
    return this.run(this.emitters().context.emitInput(text, images, source, streamingBehavior));
  }

  private emitters(): Emitters {
    this.cachedEmitters ??= createEmitters({
      assertActive: () => this.assertActive(),
      createContext: () => this.createContext(),
      emitError: (error) => this.emitError(error),
      extensions: this.extensions,
    });
    return this.cachedEmitters;
  }

  private run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    return platformRuntime.runPromise(unwrapForeign(effect));
  }
}
