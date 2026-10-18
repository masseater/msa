import { Duration, Effect, Result } from "effect";

import { describeChanges, describeChangeText, isTerminalChange } from "./changes.ts";
import type { PrWatchFailure, PrWatchGh, PrWatchGhError } from "./gh.ts";
import type { PrSnapshot, PrWatchTarget } from "./snapshot.ts";

export interface PrNotification {
  readonly label: string;
  readonly text: string;
}

export interface PrWatchHost {
  notify: (notification: PrNotification) => void;
  changed: () => void;
}

export type PrWatchStatus = "watching" | "stopped";

export interface PrWatchEntry {
  readonly target: PrWatchTarget;
  readonly key: string;
  readonly label: string;
  readonly baseIntervalMs: number;
  intervalMs: number;
  status: PrWatchStatus;
  snapshot: PrSnapshot | undefined;
  lastNotification: PrNotification | undefined;
  error: string | undefined;
  notifiedError: string | undefined;
  polls: number;
}

const MAX_INTERVAL_MS = 10 * 60_000;

const FATAL_FAILURES: ReadonlySet<PrWatchFailure> = new Set(["missing", "auth", "not-found"]);

const RATE_LIMIT_BACKOFF = 4;
const ERROR_BACKOFF = 2;

export function prWatchKey(target: PrWatchTarget): string {
  return `${target.repository ?? ""}#${target.number}`;
}

export function prWatchLabel(target: PrWatchTarget): string {
  return target.repository === undefined
    ? `#${target.number}`
    : `${target.repository}#${target.number}`;
}

export function createPrWatchEntry(target: PrWatchTarget, intervalMs: number): PrWatchEntry {
  return {
    target,
    key: prWatchKey(target),
    label: prWatchLabel(target),
    baseIntervalMs: intervalMs,
    intervalMs,
    status: "watching",
    snapshot: undefined,
    lastNotification: undefined,
    error: undefined,
    notifiedError: undefined,
    polls: 0,
  };
}

function retryNotice(entry: PrWatchEntry): string {
  return `Retrying every ${Math.round(entry.intervalMs / 1000)}s.`;
}

function handleFailure(entry: PrWatchEntry, host: PrWatchHost, failure: PrWatchGhError): void {
  entry.error = failure.message;
  if (FATAL_FAILURES.has(failure.kind)) {
    entry.status = "stopped";
    host.notify({
      label: "watch stopped",
      text: `${entry.label}: ${failure.message}. The watch stopped; start it again after fixing this.`,
    });
    return;
  }
  const backoff = failure.kind === "rate-limit" ? RATE_LIMIT_BACKOFF : ERROR_BACKOFF;
  entry.intervalMs = Math.min(entry.intervalMs * backoff, MAX_INTERVAL_MS);
  if (entry.notifiedError === failure.message) return;
  entry.notifiedError = failure.message;
  host.notify({
    label: "gh error",
    text: `${entry.label}: ${failure.message}. ${retryNotice(entry)}`,
  });
}

function handleSnapshot(entry: PrWatchEntry, host: PrWatchHost, current: PrSnapshot): void {
  entry.error = undefined;
  entry.notifiedError = undefined;
  entry.intervalMs = entry.baseIntervalMs;
  const previous = entry.snapshot;
  entry.snapshot = current;
  if (previous === undefined) return;
  const changes = describeChanges(previous, current);
  if (changes.length === 0) return;
  const notification: PrNotification = {
    label: changes.map((change) => change.label).join(", "),
    text: describeChangeText(entry.label, changes),
  };
  entry.lastNotification = notification;
  if (isTerminalChange(changes)) entry.status = "stopped";
  host.notify(notification);
}

function poll(options: PrWatchLoopOptions): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { entry, host } = options;
    const outcome = yield* options.gh(entry.target).pipe(Effect.result);
    entry.polls += 1;
    if (Result.isFailure(outcome)) handleFailure(entry, host, outcome.failure);
    else handleSnapshot(entry, host, outcome.success);
    host.changed();
    if (entry.status === "watching") yield* Effect.sleep(Duration.millis(entry.intervalMs));
  });
}

export interface PrWatchLoopOptions {
  readonly gh: PrWatchGh;
  readonly entry: PrWatchEntry;
  readonly host: PrWatchHost;
}

export function prWatchLoop(options: PrWatchLoopOptions): Effect.Effect<void> {
  return Effect.whileLoop({
    while: () => options.entry.status === "watching",
    body: () => poll(options),
    step: () => undefined,
  });
}
