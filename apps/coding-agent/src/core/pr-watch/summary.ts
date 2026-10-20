import type serviceTypes from "./service.types.ts";
import snapshotModule from "./snapshot.ts";
import type snapshotTypes from "./snapshot.types.ts";
import type watchTypes from "./watch.types.ts";

const { isBehind, isConflicting } = snapshotModule;

const CI_STALL_MS = 10 * 60_000;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
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
    const names = checks.pendingNames.length > 0 ? ` (${checks.pendingNames.join(", ")})` : "";
    if (entry.pendingSince !== undefined && now - entry.pendingSince >= CI_STALL_MS) {
      return `CI stalled ${formatElapsed(now - entry.pendingSince)}${names}`;
    }
    return `checks running${names}`;
  }
  if (checks.failed > 0) return `${checks.failed} failed`;
  return "CI passed";
}

function isStalled(entry: watchTypes.PrWatchEntry, now: number): boolean {
  return (
    entry.pendingSince !== undefined &&
    (entry.snapshot?.checks.pending ?? 0) > 0 &&
    now - entry.pendingSince >= CI_STALL_MS
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
    return `CI ${snapshot.checks.passed + snapshot.checks.failed}/${snapshot.checks.total}`;
  }
  if (snapshot.checks.failed > 0) return `${snapshot.checks.failed} failed`;
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
  CI_STALL_MS,
  describePrWatchIndicator,
  describePrWatchState,
  describePrWatchStatus,
  describeWatchStatus,
};

export default summary;
