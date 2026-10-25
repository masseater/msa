import type changesTypes from "./changes.types.ts";
import snapshot from "./snapshot.ts";
import type snapshotTypes from "./snapshot.types.ts";

const { describeChecks, isBehind, isConflicting } = snapshot;

function change(
  kind: changesTypes.PrChangeKind,
  label: string,
  text: string,
  terminal = false,
): changesTypes.PrChange {
  return { kind, label, terminal, text };
}

function commentChange(count: number): changesTypes.PrChange {
  const noun = count === 1 ? "comment" : "comments";
  return change("comment", "comment", `has ${count} new ${noun}. Read them before the next push.`);
}

function checkChange(
  previous: snapshotTypes.PrCheckCounts,
  current: snapshotTypes.PrCheckCounts,
): changesTypes.PrChange | undefined {
  if (current.total === 0 || current.pending > 0) return undefined;
  const unchanged =
    previous.total === current.total &&
    previous.passed === current.passed &&
    previous.failed === current.failed &&
    previous.cancelled === current.cancelled;
  if (unchanged) return undefined;
  const summary = describeChecks(current);
  if (current.failed > 0) {
    return change(
      "checks-failed",
      "CI failed",
      `CI finished: ${summary}. Fix the failing checks and push.`,
    );
  }
  if (current.cancelled > 0) {
    return change(
      "checks-cancelled",
      "CI cancelled",
      `CI finished: ${summary}. Run the cancelled checks again or push.`,
    );
  }
  return change(
    "checks-passed",
    "CI passed",
    `CI finished: ${summary}. Merge it once it is approved.`,
  );
}

function reviewChange(previous: string, current: string): changesTypes.PrChange | undefined {
  if (previous === current) return undefined;
  if (current === "APPROVED") {
    return change("review", "approved", "approved. Merge it when you are ready.");
  }
  if (current === "CHANGES_REQUESTED") {
    return change(
      "review",
      "changes requested",
      "has changes requested. Address the review comments and push.",
    );
  }
  if (current === "REVIEW_REQUIRED") {
    return change(
      "review",
      "review",
      "needs a review after the latest push. Wait for the reviewer.",
    );
  }
  return undefined;
}

function baseMovedChange(current: snapshotTypes.PrSnapshot): changesTypes.PrChange {
  const behind = current.behindBy;
  const distance =
    behind === undefined || behind === 0 ? "" : ` by ${behind} commit${behind === 1 ? "" : "s"}`;
  return change(
    "base-moved",
    "base moved",
    `its base moved ahead${distance}. Rebase or update the branch; CI does not run until it is up to date.`,
  );
}

function describeChanges(
  previous: snapshotTypes.PrSnapshot,
  current: snapshotTypes.PrSnapshot,
): readonly changesTypes.PrChange[] {
  if (current.state === "MERGED" && previous.state !== "MERGED") {
    return [
      change(
        "merged",
        "merged",
        "merged. The watch stopped; pull the base branch before you continue.",
        true,
      ),
    ];
  }
  if (current.state === "CLOSED" && previous.state !== "CLOSED") {
    return [
      change(
        "closed",
        "closed",
        "closed without merging. The watch stopped; reopen it or open a new pull request.",
        true,
      ),
    ];
  }

  const changes: changesTypes.PrChange[] = [];
  if (!isConflicting(previous) && isConflicting(current)) {
    changes.push(
      change(
        "conflict",
        "conflict",
        "now conflicts with its base. Rebase onto the base branch and push.",
      ),
    );
  } else if (!isBehind(previous) && isBehind(current)) {
    changes.push(baseMovedChange(current));
  }
  const checks = checkChange(previous.checks, current.checks);
  if (checks !== undefined) changes.push(checks);
  const review = reviewChange(previous.reviewDecision, current.reviewDecision);
  if (review !== undefined) changes.push(review);
  if (current.comments > previous.comments) {
    changes.push(commentChange(current.comments - previous.comments));
  }
  return changes;
}

function describeChangeText(target: string, changes: readonly changesTypes.PrChange[]): string {
  return `${target}: ${changes.map((entry) => entry.text).join(" ")}`;
}

function isTerminalChange(changes: readonly changesTypes.PrChange[]): boolean {
  return changes.some((entry) => entry.terminal);
}

const changes = {
  describeChangeText,
  describeChanges,
  isTerminalChange,
};

export default changes;
