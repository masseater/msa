import {
  type Api,
  type Context,
  calculateCost,
  type Model,
  type ModelsSimpleStreamOptions,
  type SimpleStreamOptions,
  type Usage,
} from "@msa/ai";
import { getProviderEnvValue } from "@msa/ai/utils/provider-env";

import type { ModelRuntime } from "./model-runtime.ts";
import type { SessionEntry, SessionManager, UsageEntry } from "./session-manager.ts";
import type { CacheWarmingMode } from "./settings-manager.ts";

const MAX_WARMING_AGE_MS = 60 * 60_000;
const MAX_IDLE_WARMING_AGE_MS = 30 * 60_000;
const CACHE_WARMING_MINIMUM_EXPECTED_SAVINGS = 0.05;
const IDLE_CONTINUATION_PROBABILITY = 0.15;

export function getCacheWarmingDelayMs(ttlMs: number): number | undefined {
  if (ttlMs <= 10_000) return undefined;
  return Math.max(1, Math.floor(Math.min(ttlMs * 0.9, ttlMs - 10_000)));
}

export function getPromptCacheTtlMs(
  model: Model<Api>,
  options: SimpleStreamOptions | undefined,
): number | undefined {
  const retention =
    options?.cacheRetention ??
    (getProviderEnvValue("MSA_CACHE_RETENTION", options?.env) === "long" ? "long" : "short");
  if (retention === "none") return undefined;
  const seconds = model.promptCache?.[retention];
  return seconds === undefined ? undefined : seconds * 1000;
}

export function isReplayable(model: Model<Api>, options: SimpleStreamOptions | undefined): boolean {
  if (options?.reasoning === undefined || model.api !== "anthropic-messages") return true;
  return (model as Model<"anthropic-messages">).compat?.forceAdaptiveThinking === true;
}

function lastPromptTokens(entries: SessionEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type === "message" && entry.message.role === "assistant") {
      const usage = entry.message.usage;
      return usage.input + usage.cacheRead + usage.cacheWrite;
    }
  }
  return 0;
}

function price(
  model: Model<Api>,
  tokens: Partial<Pick<Usage, "input" | "output" | "cacheRead" | "cacheWrite">>,
): number {
  const usage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...tokens,
  };
  return calculateCost(model, usage).total;
}

export type CacheWarmingAction = "warm" | "stop";

export interface CacheWarmingDecision {
  phase: "streaming" | "idle";
  warmCost: number;
  missCost: number;
  continuationProbability: number;
  expectedSavings: number;
  economicsAvailable: boolean;
  action: CacheWarmingAction;
}

export interface CacheWarmingDecisionEvent extends Pick<
  CacheWarmingDecision,
  "warmCost" | "missCost" | "continuationProbability" | "action"
> {
  type: "cache_warming_decision";
}

export interface CacheWarmingDecisionEventResult {
  action?: CacheWarmingAction;
}

export interface CacheWarmingStatus {
  state: "inactive" | "scheduled" | "refreshing";
  reason?: string;
  nextWarmAt?: number;
  decision?: CacheWarmingDecision;
  extensionOverride?: boolean;
}

export interface CacheWarmRequest {
  model: Model<Api>;
  context: Context;
  options: ModelsSimpleStreamOptions;
}

interface ActiveRun extends CacheWarmRequest {
  isCurrent: () => boolean;
  ttlMs: number;
  delayMs: number;
  refreshDeadlineAt: number;
  startedAt: number;
  controller: AbortController;
  phase: "streaming" | "idle";
  nextWarmAt: number;
  extensionOverride: boolean;
  timer?: ReturnType<typeof setTimeout> | undefined;
}

export class CacheWarmer {
  private run?: ActiveRun | undefined;
  private inactive: CacheWarmingStatus;
  private readonly models: Pick<ModelRuntime, "streamSimple">;
  private readonly sessionManager: Pick<SessionManager, "appendUsage" | "getBranch">;
  private readonly getMode: () => CacheWarmingMode;
  private readonly decide: (event: CacheWarmingDecisionEvent) => Promise<CacheWarmingAction>;
  onWarmed?: ((entry: UsageEntry) => void) | undefined;

  constructor(
    models: Pick<ModelRuntime, "streamSimple">,
    sessionManager: Pick<SessionManager, "appendUsage" | "getBranch">,
    getMode: () => CacheWarmingMode,
    decide: (event: CacheWarmingDecisionEvent) => Promise<CacheWarmingAction> = async (event) =>
      event.action,
  ) {
    this.models = models;
    this.sessionManager = sessionManager;
    this.getMode = getMode;
    this.decide = decide;
    this.inactive = { state: "inactive", reason: "waiting for first request" };
  }

  get status(): CacheWarmingStatus {
    if (this.getMode() === "off") return { state: "inactive", reason: "cache warming disabled" };
    const run = this.run;
    if (run === undefined) return this.inactive;
    if (!run.isCurrent()) return { state: "inactive", reason: "conversation context changed" };
    const decision = this.evaluate(run);
    const refreshing = run.timer === undefined;
    if (!decision.economicsAvailable && !refreshing) {
      return { state: "inactive", reason: "cache economics unavailable" };
    }
    return {
      state: refreshing ? "refreshing" : "scheduled",
      nextWarmAt: run.nextWarmAt,
      decision,
      extensionOverride: run.extensionOverride,
    };
  }

  start(request: CacheWarmRequest, isCurrent: () => boolean): void {
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
      isCurrent,
      ttlMs,
      delayMs,
      refreshDeadlineAt: 0,
      startedAt: Date.now(),
      controller: new AbortController(),
      phase: "streaming",
      nextWarmAt: 0,
      extensionOverride: false,
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
    if (run.nextWarmAt > deadline || Date.now() >= deadline) {
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

  private clearRun(): void {
    const run = this.run;
    if (run === undefined) return;
    this.run = undefined;
    if (run.timer !== undefined) clearTimeout(run.timer);
    run.controller.abort();
  }

  private stop(
    reason: string,
    stopped?: Pick<CacheWarmingStatus, "decision" | "extensionOverride">,
  ): void {
    this.clearRun();
    this.inactive = { state: "inactive", reason, ...stopped };
  }

  private schedule(run: ActiveRun): void {
    run.extensionOverride = false;
    run.nextWarmAt = Date.now() + run.delayMs;
    run.refreshDeadlineAt = run.nextWarmAt + Math.floor((run.ttlMs - run.delayMs) / 2);
    const deadline =
      run.startedAt + (run.phase === "idle" ? MAX_IDLE_WARMING_AGE_MS : MAX_WARMING_AGE_MS);
    if (run.nextWarmAt > deadline || Date.now() >= deadline) {
      this.stop(
        run.phase === "idle"
          ? "30-minute idle safety limit reached"
          : "one-hour safety limit reached",
      );
      return;
    }
    run.timer = setTimeout(() => void this.refresh(run), Math.max(0, run.nextWarmAt - Date.now()));
    run.timer.unref?.();
  }

  private async refresh(run: ActiveRun): Promise<void> {
    run.timer = undefined;
    if (!this.validateRun(run)) return;
    if (this.refreshDeadlineMissed(run)) return;
    const decision = this.evaluate(run);
    const { warmCost, missCost, continuationProbability } = decision;
    let action = decision.action;
    try {
      action = await this.decide({
        type: "cache_warming_decision",
        warmCost,
        missCost,
        continuationProbability,
        action,
      });
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
      const message = await this.models
        .streamSimple(run.model, run.context, {
          ...run.options,
          maxTokens: 1,
          maxRetries: 0,
          signal: run.controller.signal,
        })
        .result();
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
  }

  private refreshDeadlineMissed(run: ActiveRun): boolean {
    if (Date.now() <= run.refreshDeadlineAt) return false;
    this.stop("cache refresh deadline missed");
    return true;
  }

  private validateRun(run: ActiveRun): boolean {
    if (this.run !== run) return false;
    const reason =
      this.getModeStopReason(run) ?? (run.isCurrent() ? undefined : "conversation context changed");
    if (reason === undefined || reason === "") return true;
    this.stop(reason);
    return false;
  }

  private getModeStopReason(run: ActiveRun): string | undefined {
    const mode = this.getMode();
    if (mode === "off") return "cache warming disabled";
    if (mode === "streaming" && run.phase === "idle") return "agent run settled";
    return undefined;
  }

  private evaluate(run: ActiveRun): CacheWarmingDecision {
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
      phase: run.phase,
      warmCost,
      missCost,
      continuationProbability,
      expectedSavings,
      economicsAvailable,
      action: expectedSavings >= CACHE_WARMING_MINIMUM_EXPECTED_SAVINGS ? "warm" : "stop",
    };
  }
}

function formatDollars(value: number): string {
  return value < 0 ? `-$${Math.abs(value).toFixed(3)}` : `$${value.toFixed(3)}`;
}

function formatCacheWarmingEconomics(decision: CacheWarmingDecision): string {
  if (!decision.economicsAvailable) return "cache economics unavailable";
  const probability = Math.round(decision.continuationProbability * 100);
  const probabilityText =
    decision.phase === "streaming"
      ? `${probability}% continuation probability while agent is running`
      : `${probability}% continuation probability`;
  const comparison = decision.action === "warm" ? ">=" : "<";
  return `${probabilityText}, expected savings ${formatDollars(decision.expectedSavings)} ${comparison} $${CACHE_WARMING_MINIMUM_EXPECTED_SAVINGS.toFixed(3)}`;
}

function formatCacheWarmingDecisionTime(nextWarmAt: number | undefined, now: number): string {
  if (nextWarmAt === undefined || nextWarmAt <= now) return "Decision now";
  let remainingSeconds = Math.ceil((nextWarmAt - now) / 1000);
  const hours = Math.floor(remainingSeconds / 3600);
  remainingSeconds %= 3600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return `Decision in ${parts.join(" ")}`;
}

export function formatCacheWarmingStatus(status: CacheWarmingStatus, now = Date.now()): string {
  const decision = status.decision;
  if (
    decision === undefined ||
    (status.state === "inactive" &&
      !decision.economicsAvailable &&
      status.extensionOverride !== true)
  ) {
    return `Inactive (${status.reason ?? "unknown reason"})`;
  }
  const details =
    status.extensionOverride === true
      ? `extension override, ${formatCacheWarmingEconomics(decision)}`
      : `${formatCacheWarmingEconomics(decision)} -> ${decision.action}`;
  if (status.state === "inactive") return `Stopped (${details})`;
  if (status.state === "refreshing") return `Warming cache (${details})`;
  return `${formatCacheWarmingDecisionTime(status.nextWarmAt, now)} (${details})`;
}

export function formatCacheWarmingUsage(entry: UsageEntry): string {
  const note = entry.note !== undefined && entry.note !== "" ? ` (${entry.note})` : "";
  const cost = entry.usage.cost.total.toFixed(6).replace(/(\.\d{3}\d*?)0+$/u, "$1");
  return `Cache warmed${note}: $${cost}`;
}
