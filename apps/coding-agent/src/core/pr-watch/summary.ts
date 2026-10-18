import type { PrWatchSnapshot } from "./service.ts";
import type { PrWatchEntry } from "./watch.ts";

export function describePrWatchState(entry: PrWatchEntry): string {
  if (entry.error !== undefined) return "gh error";
  const snapshot = entry.snapshot;
  if (snapshot === undefined) return "waiting for gh";
  if (snapshot.state === "MERGED") return "merged";
  if (snapshot.state === "CLOSED") return "closed";
  if (snapshot.mergeable === "CONFLICTING") return "conflict";
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

export function describePrWatchIndicator(snapshot: PrWatchSnapshot): string | undefined {
  if (snapshot.entries.length === 0) return undefined;
  const watching = snapshot.entries
    .map((entry) => `${entry.label} ${describePrWatchState(entry)}`)
    .join(" · ");
  const last = snapshot.last;
  if (last === undefined) return `PR ${watching}`;
  return `PR ${watching} · last ${last.target} ${last.change}`;
}

export function describePrWatchStatus(snapshot: PrWatchSnapshot): string[] {
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
