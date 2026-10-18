import { Effect } from "effect";

import { PrWatchGhError, type PrWatchGh } from "../src/core/pr-watch/gh.ts";
import type { PrSnapshot } from "../src/core/pr-watch/snapshot.ts";
import type { PrNotification, PrWatchHost } from "../src/core/pr-watch/watch.ts";

export const INTERVAL_MS = 45_000;
export const STATUS_INTERVAL_MS = 300_000;

export const snapshotOf = (overrides: Partial<PrSnapshot> = {}): PrSnapshot => ({
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: "REVIEW_REQUIRED",
  updatedAt: "2024-05-01T00:00:00Z",
  comments: 0,
  checks: {
    total: 2,
    passed: 0,
    failed: 0,
    pending: 2,
    pendingNames: ["verify"],
  },
  baseRefName: "main",
  headRefOid: "head-oid",
  behindBy: undefined,
  ...overrides,
});

export const pendingChecks = snapshotOf();

export interface HostLog {
  readonly host: PrWatchHost;
  readonly notifications: PrNotification[];
  readonly changes: { count: number };
}

export const createHost = (): HostLog => {
  const notifications: PrNotification[] = [];
  const changes = { count: 0 };
  return {
    notifications,
    changes,
    host: {
      notify: (notification) => {
        notifications.push(notification);
      },
      changed: () => {
        changes.count += 1;
      },
    },
  };
};

export interface ScriptedGh {
  readonly gh: PrWatchGh;
  readonly calls: { count: number };
  readonly behindCalls: { count: number };
}

export const scriptedGh = (
  steps: ReadonlyArray<PrSnapshot | PrWatchGhError>,
  behindBy?: number,
): ScriptedGh => {
  const calls = { count: 0 };
  const behindCalls = { count: 0 };
  return {
    calls,
    behindCalls,
    gh: {
      view: () => {
        const step = steps[Math.min(calls.count, steps.length - 1)]!;
        calls.count += 1;
        return step instanceof PrWatchGhError ? Effect.fail(step) : Effect.succeed(step);
      },
      behind: () => {
        behindCalls.count += 1;
        return behindBy === undefined
          ? Effect.fail(new PrWatchGhError({ kind: "other", message: "no compare" }))
          : Effect.succeed(behindBy);
      },
    },
  };
};

export const neverGh = (): PrWatchGh => ({ view: () => Effect.never, behind: () => Effect.never });

export const waitFor = async (predicate: () => boolean, timeoutMs = 3000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
