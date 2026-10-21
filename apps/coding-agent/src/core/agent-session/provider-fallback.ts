import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import platform from "../platform/index.ts";

const { isContextOverflow, isProviderUnusableError } = compat;
const { awaitingWith, performed } = awaitingModule;
const { formatLocalDateTime, nowMs } = platform;

const PROVIDER_STALLED_MESSAGE_TYPE = "msa.provider.stalled";
const PROVIDER_RESUMED_MESSAGE_TYPE = "msa.provider.resumed";

const reference = (provider: string, model: string): string => `${provider}/${model}`;

export default class SessionProviderFallback {
  private readonly session: AgentSession;

  private readonly failedProviders = new Set<string>();

  private stalledInternal: { at: number; model: string; errorMessage: string } | undefined;

  constructor(session: AgentSession) {
    this.session = session;
  }

  get stalled(): { at: number; model: string; errorMessage: string } | undefined {
    return this.stalledInternal;
  }

  afterResponse(message: compatTypes.AssistantMessage): Effect.Effect<boolean> {
    if (message.stopReason === "aborted") return Effect.succeed(false);
    if (message.stopReason !== "error") {
      this.recordSuccess(message);
      return Effect.succeed(false);
    }
    return this.isUnusable(message) ? this.recover(message) : Effect.succeed(false);
  }

  private isUnusable(message: compatTypes.AssistantMessage): boolean {
    if (!isProviderUnusableError(message)) return false;
    const model = this.session.models.selection.modelForMessage(message) ?? this.session.model;
    return !isContextOverflow(message, model?.contextWindow ?? 0);
  }

  private recover(message: compatTypes.AssistantMessage): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      this.failedProviders.add(message.provider);
      const errorMessage = message.errorMessage ?? "Unknown error";
      const next = yield* performed(
        this.session.models.selection.fallbackModel(this.failedProviders),
      );
      if (next === undefined) {
        this.stall(message, errorMessage);
        return false;
      }
      this.session.run.retry.omitRecoveryAttempt(message);
      this.session.emit({
        errorMessage,
        from: reference(message.provider, message.model),
        to: reference(next.provider, next.id),
        type: "model_fallback",
      });
      return true;
    }, this);
  }

  private recordSuccess(message: compatTypes.AssistantMessage): void {
    this.failedProviders.clear();
    const stalled = this.stalledInternal;
    if (stalled === undefined) return;
    this.stalledInternal = undefined;
    this.session.emit({
      model: reference(message.provider, message.model),
      since: stalled.at,
      type: "provider_recovered",
    });
  }

  resumeAfterModelChange(): void {
    const stalled = this.stalledInternal;
    const model = this.session.model;
    if (stalled === undefined || model === undefined || this.session.isStreaming) return;
    this.failedProviders.clear();
    void this.session.run.prompting.sendCustomMessage(
      {
        content: `Switched to ${reference(model.provider, model.id)}. Continue from the stop at ${formatLocalDateTime(stalled.at)}, including every report that arrived since then.`,
        customType: PROVIDER_RESUMED_MESSAGE_TYPE,
        display: true,
      },
      { triggerTurn: true },
    );
  }

  private stall(message: compatTypes.AssistantMessage, errorMessage: string): void {
    if (this.stalledInternal !== undefined) return;
    const stalled = {
      at: nowMs(),
      errorMessage,
      model: reference(message.provider, message.model),
    };
    this.stalledInternal = stalled;
    this.session.emit({ ...stalled, type: "provider_stalled" });
    void this.session.run.prompting.sendCustomMessage(
      {
        content: `Model calls stopped at ${formatLocalDateTime(stalled.at)}: ${stalled.model} failed with "${errorMessage}" and no model in enabledModels could take over.`,
        customType: PROVIDER_STALLED_MESSAGE_TYPE,
        display: true,
      },
      { triggerTurn: false },
    );
  }
}
