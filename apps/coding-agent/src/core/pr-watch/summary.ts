import elapsed from "../../utils/elapsed.ts";
import ciHistory from "./ci-history.ts";
import type ciHistoryTypes from "./ci-history.types.ts";
import type serviceTypes from "./service.types.ts";
import snapshotModule from "./snapshot.ts";
import type snapshotTypes from "./snapshot.types.ts";
import type watchTypes from "./watch.types.ts";

const { isBehind, isConflicting } = snapshotModule;
const { formatElapsed } = elapsed;
const { stallLimit } = ciHistory;

function stallLimitOf(entry: watchTypes.PrWatchEntry): ciHistoryTypes.CiStallLimit | undefined {
  const runs = entry.ciHistory?.runs;
  const checks = entry.snapshot?.checks;
  if (runs === undefined || checks === undefined) return undefined;
  return stallLimit(runs, checks.pendingWorkflows);
}

function reviewLabel(reviewDecision: string): string | undefined {
  switch (reviewDecision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes requested";
    case "REVIEW_REQUIRED":
      return "review required";
    default:
      return undefined;
  }
}

function behindLabel(snapshot: snapshotTypes.PrSnapshot): string {
  const behind = snapshot.behindBy;
  if (behind === undefined || behind === 0) return "base moved ahead";
  return `base ${behind} behind`;
}

function checksLabel(entry: watchTypes.PrWatchEntry, now: number): string {
  const checks = entry.snapshot?.checks;
  if (checks === undefined || checks.total === 0) return "no checks";
  if (checks.pending > 0) {
    const limit = stallLimitOf(entry);
    const usual =
      limit === undefined ? "no past runs to compare" : `usually ${formatElapsed(limit.typicalMs)}`;
    const details = [...checks.pendingNames, usual].join("; ");
    const running =
      entry.pendingSince === undefined ? "" : ` ${formatElapsed(now - entry.pendingSince)}`;
    return isStalled(entry, now)
      ? `CI stalled${running} (${details})`
      : `checks running${running} (${details})`;
  }
  if (checks.failed > 0) return `${checks.failed} failed`;
  if (checks.cancelled > 0) return `${checks.cancelled} cancelled`;
  return "CI passed";
}

function isStalled(entry: watchTypes.PrWatchEntry, now: number): boolean {
  const limit = stallLimitOf(entry);
  return (
    limit !== undefined &&
    entry.pendingSince !== undefined &&
    (entry.snapshot?.checks.pending ?? 0) > 0 &&
    now - entry.pendingSince >= limit.limitMs
  );
}

function describeWatchStatus(entry: watchTypes.PrWatchEntry, now: number): string | undefined {
  const snapshot = entry.snapshot;
  if (entry.error !== undefined) return undefined;
  if (snapshot === undefined) return "no read from gh yet";
  const parts = [checksLabel(entry, now)];
  if (isConflicting(snapshot)) {
    parts.push("conflict");
  } else if (isBehind(snapshot)) {
    const moved =
      entry.baseMovedAt === undefined ? "" : ` for ${formatElapsed(now - entry.baseMovedAt)}`;
    parts.push(`${behindLabel(snapshot)}${moved}`);
  } else {
    parts.push("mergeable");
  }
  const review = reviewLabel(snapshot.reviewDecision);
  if (review !== undefined) parts.push(review);
  const stalled = isStalled(entry, now) ? " — it may be stalled; check the run or push again" : "";
  return `${parts.join(", ")}${stalled}`;
}

function describePrWatchState(entry: watchTypes.PrWatchEntry): string {
  if (entry.error !== undefined) return "gh error";
  const snapshot = entry.snapshot;
  if (snapshot === undefined) return "waiting for gh";
  if (snapshot.state === "MERGED") return "merged";
  if (snapshot.state === "CLOSED") return "closed";
  if (isConflicting(snapshot)) return "conflict";
  if (isBehind(snapshot)) return behindLabel(snapshot);
  if (snapshot.checks.pending > 0) {
    const done = snapshot.checks.passed + snapshot.checks.failed + snapshot.checks.cancelled;
    return `CI ${done}/${snapshot.checks.total}`;
  }
  if (snapshot.checks.failed > 0) return `${snapshot.checks.failed} failed`;
  if (snapshot.checks.cancelled > 0) return `${snapshot.checks.cancelled} cancelled`;
  if (snapshot.reviewDecision === "APPROVED") return "approved";
  if (snapshot.reviewDecision === "CHANGES_REQUESTED") return "changes requested";
  if (snapshot.reviewDecision === "REVIEW_REQUIRED") return "review";
  if (snapshot.checks.total > 0) return "CI passed";
  return "open";
}

function describePrWatchIndicator(snapshot: serviceTypes.PrWatchSnapshot): string | undefined {
  if (snapshot.entries.length === 0) return undefined;
  const watching = snapshot.entries
    .map((entry) => `${entry.label} ${describePrWatchState(entry)}`)
    .join(" · ");
  const last = snapshot.last;
  if (last === undefined) return `PR ${watching}`;
  return `PR ${watching} · last ${last.target} ${last.change}`;
}

function describePrWatchStatus(snapshot: serviceTypes.PrWatchSnapshot): string[] {
  if (snapshot.entries.length === 0) return ["No pull requests watched"];
  const count = snapshot.entries.length;
  const lines = [`Watching ${count} pull request${count === 1 ? "" : "s"}`];
  for (const entry of snapshot.entries) {
    const every = `every ${Math.round(entry.intervalMs / 1000)}s`;
    const status = entry.status === "watching" ? every : "stopped";
    const last =
      entry.lastNotification === undefined ? "" : ` · last: ${entry.lastNotification.label}`;
    lines.push(`${entry.label} · ${describePrWatchState(entry)} · ${status}${last}`);
  }
  return lines;
}

const summary = {
  describePrWatchIndicator,
  describePrWatchState,
  describePrWatchStatus,
  describeWatchStatus,
};

export default summary;
