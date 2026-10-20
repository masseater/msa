import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import cacheWarmerHelpers from "./cache-warmer-helpers.ts";
import type cacheWarmerInternalTypes from "./cache-warmer-internal.types.ts";
import CacheWarmerLayer0 from "./cache-warmer-layer-0.ts";
import cacheWarmerSupport from "./cache-warmer-support.ts";
import type cacheWarmerTypes from "./cache-warmer.types.ts";
import platform from "./platform.ts";

const {
  CACHE_WARMING_MINIMUM_EXPECTED_SAVINGS,
  getCacheWarmingDelayMs,
  getPromptCacheTtlMs,
  isReplayable,
} = cacheWarmerSupport;
const { nowMs, schedule } = platform;
const { awaited, awaitingWith } = awaitingModule;
const {
  IDLE_CONTINUATION_PROBABILITY,
  MAX_IDLE_WARMING_AGE_MS,
  MAX_WARMING_AGE_MS,
  lastPromptTokens,
  price,
} = cacheWarmerHelpers;

export default abstract class CacheWarmerLayer1 extends CacheWarmerLayer0 {
  get status(): cacheWarmerTypes.CacheWarmingStatus {
    if (this.getMode() === "off") return { reason: "cache warming disabled", state: "inactive" };
    const run = this.run;
    if (run === undefined) return this.inactive;
    if (!run.isCurrent()) return { reason: "conversation context changed", state: "inactive" };
    const decision = this.evaluate(run);
    const refreshing = run.timer === undefined;
    if (!decision.economicsAvailable && !refreshing) {
      return { reason: "cache economics unavailable", state: "inactive" };
    }
    return {
      decision,
      extensionOverride: run.extensionOverride,
      nextWarmAt: run.nextWarmAt,
      state: refreshing ? "refreshing" : "scheduled",
    };
  }

  start(request: cacheWarmerTypes.CacheWarmRequest, isCurrent: () => boolean): void {
    this.clearRun();
    const mode = this.getMode();
    if (mode === "off") {
      this.stop("cache warming disabled");
      return;
    }
    if (!isReplayable(request.model, request.options)) {
      this.stop("request cannot be replayed safely");
      return;
    }
    const ttlMs = getPromptCacheTtlMs(request.model, request.options);
    if (ttlMs === undefined) {
      this.stop(
        request.options.cacheRetention === "none"
          ? "request disabled prompt caching"
          : "cache lifetime unavailable",
      );
      return;
    }
    const delayMs = getCacheWarmingDelayMs(ttlMs);
    if (delayMs === undefined) {
      this.stop("cache lifetime unavailable");
      return;
    }
    this.run = {
      ...request,
      controller: new AbortController(),
      delayMs,
      extensionOverride: false,
      isCurrent,
      nextWarmAt: 0,
      phase: "streaming",
      refreshDeadlineAt: 0,
      startedAt: nowMs(),
      ttlMs,
    };
    this.schedule(this.run);
  }

  onAgentSettled(): void {
    const run = this.run;
    if (run === undefined) return;
    if (this.getMode() === "streaming") {
      this.stop("agent run settled");
      return;
    }
    run.phase = "idle";
    const deadline = run.startedAt + MAX_IDLE_WARMING_AGE_MS;
    if (run.nextWarmAt > deadline || nowMs() >= deadline) {
      this.stop("30-minute idle safety limit reached");
    }
  }

  onModeChanged(): void {
    const run = this.run;
    if (run === undefined) return;
    const reason = this.getModeStopReason(run);
    if (reason !== undefined && reason !== "") this.stop(reason);
  }

  cancel(): void {
    this.stop("inactive");
  }

  protected clearRun(): void {
    const run = this.run;
    if (run === undefined) return;
    this.run = undefined;
    if (run.timer !== undefined) run.timer.cancel();
    run.controller.abort();
  }

  protected stop(
    reason: string,
    stopped?: Pick<cacheWarmerTypes.CacheWarmingStatus, "decision" | "extensionOverride">,
  ): void {
    this.clearRun();
    this.inactive = { reason, state: "inactive", ...stopped };
  }

  protected schedule(run: cacheWarmerInternalTypes.ActiveRun): void {
    run.extensionOverride = false;
    run.nextWarmAt = nowMs() + run.delayMs;
    run.refreshDeadlineAt = run.nextWarmAt + Math.floor((run.ttlMs - run.delayMs) / 2);
    const deadline =
      run.startedAt + (run.phase === "idle" ? MAX_IDLE_WARMING_AGE_MS : MAX_WARMING_AGE_MS);
    if (run.nextWarmAt > deadline || nowMs() >= deadline) {
      this.stop(
        run.phase === "idle"
          ? "30-minute idle safety limit reached"
          : "one-hour safety limit reached",
      );
      return;
    }
    run.timer = schedule(() => void this.refresh(run), Math.max(0, run.nextWarmAt - nowMs()));
  }

  protected refresh(run: cacheWarmerInternalTypes.ActiveRun): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        run.timer = undefined;
        if (!this.validateRun(run)) return;
        if (this.refreshDeadlineMissed(run)) return;
        const decision = this.evaluate(run);
        const { warmCost, missCost, continuationProbability } = decision;
        let action = decision.action;
        try {
          action = yield* awaited(
            this.decide({
              action,
              continuationProbability,
              missCost,
              type: "cache_warming_decision",
              warmCost,
            }),
          );
        } catch {}
        if (!this.validateRun(run) || this.refreshDeadlineMissed(run)) return;
        const extensionOverride = action !== decision.action;
        if (action === "stop") {
          const reason = extensionOverride
            ? "stopped by extension"
            : decision.economicsAvailable
              ? "expected savings below threshold"
              : "cache economics unavailable";
          this.stop(reason, { decision, extensionOverride });
          return;
        }

        run.extensionOverride = extensionOverride;
        try {
          const message = yield* this.refreshPart1(run);
          if (!this.validateRun(run)) return;
          if (message.stopReason !== "error" && message.stopReason !== "aborted") {
            const entry = this.sessionManager.appendUsage(
              "cache_warm",
              message.provider,
              message.responseModel ?? message.model,
              message.usage,
              extensionOverride ? "extension override" : undefined,
            );
            this.onWarmed?.(entry);
          }
        } catch {}
        if (this.run === run) this.schedule(run);
      }, this),
    );
  }

  protected *refreshPart1(run: cacheWarmerInternalTypes.ActiveRun) {
    return yield* awaited(
      this.models
        .streamSimple(run.model, run.context, {
          ...run.options,
          maxRetries: 0,
          maxTokens: 1,
          signal: run.controller.signal,
        })
        .result(),
    );
  }

  protected refreshDeadlineMissed(run: cacheWarmerInternalTypes.ActiveRun): boolean {
    if (nowMs() <= run.refreshDeadlineAt) return false;
    this.stop("cache refresh deadline missed");
    return true;
  }

  protected validateRun(run: cacheWarmerInternalTypes.ActiveRun): boolean {
    if (this.run !== run) return false;
    const reason =
      this.getModeStopReason(run) ?? (run.isCurrent() ? undefined : "conversation context changed");
    if (reason === undefined || reason === "") return true;
    this.stop(reason);
    return false;
  }

  protected getModeStopReason(run: cacheWarmerInternalTypes.ActiveRun): string | undefined {
    const mode = this.getMode();
    if (mode === "off") return "cache warming disabled";
    if (mode === "streaming" && run.phase === "idle") return "agent run settled";
    return undefined;
  }

  protected evaluate(
    run: cacheWarmerInternalTypes.ActiveRun,
  ): cacheWarmerTypes.CacheWarmingDecision {
    const model = run.model;
    const promptTokens = lastPromptTokens(this.sessionManager.getBranch());
    const cacheHitCost = price(model, { cacheRead: promptTokens });
    const cacheMissCost = price(
      model,
      model.cost.cacheWrite > 0 ? { cacheWrite: promptTokens } : { input: promptTokens },
    );
    const warmCost = price(model, { cacheRead: promptTokens, output: 1 });
    const missCost = Math.max(0, cacheMissCost - cacheHitCost);
    const continuationProbability = run.phase === "idle" ? IDLE_CONTINUATION_PROBABILITY : 1;
    const economicsAvailable = promptTokens > 0 && (cacheHitCost > 0 || cacheMissCost > 0);
    const expectedSavings = continuationProbability * missCost - warmCost;
    return {
      action: expectedSavings >= CACHE_WARMING_MINIMUM_EXPECTED_SAVINGS ? "warm" : "stop",
      continuationProbability,
      economicsAvailable,
      expectedSavings,
      missCost,
      phase: run.phase,
      warmCost,
    };
  }
}
