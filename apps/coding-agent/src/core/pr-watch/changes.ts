import { describeChecks, type PrCheckCounts, type PrSnapshot } from "./snapshot.ts";

export type PrChangeKind =
  | "merged"
  | "closed"
  | "conflict"
  | "checks-failed"
  | "checks-passed"
  | "review"
  | "comment";

export interface PrChange {
  readonly kind: PrChangeKind;
  readonly label: string;
  readonly text: string;
  readonly terminal: boolean;
}

function change(kind: PrChangeKind, label: string, text: string, terminal = false): PrChange {
  return { kind, label, text, terminal };
}

function commentChange(count: number): PrChange {
  const noun = count === 1 ? "comment" : "comments";
  return change("comment", "comment", `has ${count} new ${noun}. Read them before the next push.`);
}

function checkChange(previous: PrCheckCounts, current: PrCheckCounts): PrChange | undefined {
  if (current.total === 0 || current.pending > 0) return undefined;
  const unchanged =
    previous.total === current.total &&
    previous.passed === current.passed &&
    previous.failed === current.failed;
  if (unchanged) return undefined;
  const summary = describeChecks(current);
  if (current.failed > 0) {
    return change(
      "checks-failed",
      "CI failed",
      `CI finished: ${summary}. Fix the failing checks and push.`,
    );
  }
  return change(
    "checks-passed",
    "CI passed",
    `CI finished: ${summary}. Merge it once it is approved.`,
  );
}

function reviewChange(previous: string, current: string): PrChange | undefined {
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

export function describeChanges(previous: PrSnapshot, current: PrSnapshot): readonly PrChange[] {
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

  const changes: PrChange[] = [];
  if (previous.mergeable !== "CONFLICTING" && current.mergeable === "CONFLICTING") {
    changes.push(
      change(
        "conflict",
        "conflict",
        "now conflicts with its base. Rebase onto the base branch and push.",
      ),
    );
  }
  const checks = checkChange(previous.checks, current.checks);
  if (checks) changes.push(checks);
  const review = reviewChange(previous.reviewDecision, current.reviewDecision);
  if (review) changes.push(review);
  if (current.comments > previous.comments)
    changes.push(commentChange(current.comments - previous.comments));
  return changes;
}

export function describeChangeText(target: string, changes: readonly PrChange[]): string {
  return `${target}: ${changes.map((entry) => entry.text).join(" ")}`;
}

export function isTerminalChange(changes: readonly PrChange[]): boolean {
  return changes.some((entry) => entry.terminal);
}
