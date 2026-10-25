import { Clock, Duration, Effect, Option, Result } from "effect";

import changesModule from "./changes.ts";
import type changesTypes from "./changes.types.ts";
import type ghTypes from "./gh.types.ts";
import snapshotModule from "./snapshot.ts";
import type snapshotTypes from "./snapshot.types.ts";
import summary from "./summary.ts";
import type watchTypes from "./watch.types.ts";

const { isBehind } = snapshotModule;
const { describeChangeText, describeChanges, isTerminalChange } = changesModule;
const { describeWatchStatus } = summary;

const MAX_INTERVAL_MS = 10 * 60_000;

const FATAL_FAILURES: ReadonlySet<ghTypes.PrWatchFailure> = new Set([
  "missing",
  "auth",
  "not-found",
]);

function ciConclusion(kind: changesTypes.PrChangeKind): watchTypes.CiConclusion | undefined {
  if (kind === "checks-passed") return "passed";
  if (kind === "checks-failed") return "failed";
  if (kind === "checks-cancelled") return "cancelled";
  return undefined;
}

const RATE_LIMIT_BACKOFF = 4;
const ERROR_BACKOFF = 2;

function prWatchKey(target: snapshotTypes.PrWatchTarget): string {
  return `${target.repository ?? ""}#${target.number}`;
}

function prWatchLabel(target: snapshotTypes.PrWatchTarget): string {
  return target.repository === undefined
    ? `#${target.number}`
    : `${target.repository}#${target.number}`;
}

function createPrWatchEntry(
  target: snapshotTypes.PrWatchTarget,
  intervalMs: number,
  statusIntervalMs: number,
): watchTypes.PrWatchEntry {
  return {
    baseIntervalMs: intervalMs,
    baseMovedAt: undefined,
    error: undefined,
    intervalMs,
    key: prWatchKey(target),
    label: prWatchLabel(target),
    lastNotification: undefined,
    lastNotificationAt: undefined,
    notifiedError: undefined,
    pendingSince: undefined,
    polls: 0,
    snapshot: undefined,
    startedAt: undefined,
    status: "watching",
    statusIntervalMs,
    target,
  };
}

function retryNotice(entry: watchTypes.PrWatchEntry): string {
  return `Retrying every ${Math.round(entry.intervalMs / 1000)}s.`;
}

function handleFailure(
  entry: watchTypes.PrWatchEntry,
  host: watchTypes.PrWatchHost,
  failure: ghTypes.PrWatchGhError,
): boolean {
  entry.error = failure.message;
  if (FATAL_FAILURES.has(failure.kind)) {
    entry.status = "stopped";
    host.notify({
      label: "watch stopped",
      text: `${entry.label}: ${failure.message}. The watch stopped; start it again after fixing this.`,
      wake: true,
    });
    return true;
  }
  const backoff = failure.kind === "rate-limit" ? RATE_LIMIT_BACKOFF : ERROR_BACKOFF;
  entry.intervalMs = Math.min(entry.intervalMs * backoff, MAX_INTERVAL_MS);
  if (entry.notifiedError === failure.message) return false;
  entry.notifiedError = failure.message;
  host.notify({
    label: "gh error",
    text: `${entry.label}: ${failure.message}. ${retryNotice(entry)}`,
    wake: true,
  });
  return true;
}

function trackTimers(
  entry: watchTypes.PrWatchEntry,
  previous: snapshotTypes.PrSnapshot | undefined,
  current: snapshotTypes.PrSnapshot,
  now: number,
): void {
  if (current.checks.pending > 0) {
    if (previous === undefined || previous.checks.pending === 0) entry.pendingSince = now;
  } else {
    entry.pendingSince = undefined;
  }
  if (isBehind(current)) {
    if (previous === undefined || !isBehind(previous)) entry.baseMovedAt = now;
  } else {
    entry.baseMovedAt = undefined;
  }
}

function applySnapshot(
  entry: watchTypes.PrWatchEntry,
  host: watchTypes.PrWatchHost,
  current: snapshotTypes.PrSnapshot,
  now: number,
): boolean {
  const previous = entry.snapshot;
  const pendingSince = entry.pendingSince;
  trackTimers(entry, previous, current, now);
  entry.snapshot = current;
  if (previous === undefined) return false;
  const changes = describeChanges(previous, current);
  if (changes.length === 0) return false;
  const checks = changes
    .map((change) => ciConclusion(change.kind))
    .find((conclusion) => conclusion !== undefined);
  const notification: watchTypes.PrNotification = {
    label: changes.map((change) => change.label).join(", "),
    text: describeChangeText(entry.label, changes),
    wake: true,
    ...(checks === undefined || pendingSince === undefined
      ? {}
      : {
          ci: {
            conclusion: checks,
            durationMs: now - pendingSince,
          },
        }),
  };
  entry.lastNotification = notification;
  if (isTerminalChange(changes)) entry.status = "stopped";
  host.notify(notification);
  return true;
}

function readBehind(
  options: watchTypes.PrWatchLoopOptions,
  current: snapshotTypes.PrSnapshot,
): Effect.Effect<Option.Option<number>> {
  const worthAsking = isBehind(current) || current.mergeStateStatus === "UNKNOWN";
  if (!worthAsking || current.baseRefName === "" || current.headRefOid === "") {
    return Effect.succeedNone;
  }
  return options.gh
    .behind(options.entry.target, current.baseRefName, current.headRefOid)
    .pipe(Effect.option);
}

function handleSnapshot(
  options: watchTypes.PrWatchLoopOptions,
  current: snapshotTypes.PrSnapshot,
  now: number,
): Effect.Effect<boolean> {
  const { entry, host } = options;
  entry.error = undefined;
  entry.notifiedError = undefined;
  entry.intervalMs = entry.baseIntervalMs;
  return readBehind(options, current).pipe(
    Effect.map((behind) =>
      applySnapshot(
        entry,
        host,
        Option.isSome(behind) ? { ...current, behindBy: behind.value } : current,
        now,
      ),
    ),
  );
}

function notifyStatus(
  entry: watchTypes.PrWatchEntry,
  host: watchTypes.PrWatchHost,
  now: number,
): boolean {
  const status = describeWatchStatus(entry, now);
  if (status === undefined) return false;
  const notification: watchTypes.PrNotification = {
    label: "status",
    text: `${entry.label}: ${status}`,
    wake: false,
  };
  entry.lastNotification = notification;
  host.notify(notification);
  return true;
}

function poll(options: watchTypes.PrWatchLoopOptions): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { entry, host } = options;
    const now = yield* Clock.currentTimeMillis;
    if (entry.startedAt === undefined) entry.startedAt = now;
    const outcome = yield* options.gh.view(entry.target).pipe(Effect.result);
    entry.polls += 1;
    const notified = Result.isFailure(outcome)
      ? handleFailure(entry, host, outcome.failure)
      : yield* handleSnapshot(options, outcome.success, now);
    if (notified) {
      entry.lastNotificationAt = now;
    } else if (now - (entry.lastNotificationAt ?? entry.startedAt) >= entry.statusIntervalMs) {
      if (notifyStatus(entry, host, now)) entry.lastNotificationAt = now;
    }
    host.changed();
    if (entry.status === "watching") yield* Effect.sleep(Duration.millis(entry.intervalMs));
  });
}

function prWatchLoop(options: watchTypes.PrWatchLoopOptions): Effect.Effect<void> {
  return Effect.whileLoop({
    body: () => poll(options),
    step: () => undefined,
    while: () => options.entry.status === "watching",
  });
}

const watch = {
  createPrWatchEntry,
  prWatchKey,
  prWatchLabel,
  prWatchLoop,
};

export default watch;
