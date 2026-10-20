import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type ghTypes from "../src/core/pr-watch/gh.types.ts";
import PrWatchGhError from "../src/core/pr-watch/pr-watch-gh-error.ts";
import PrWatch from "../src/core/pr-watch/service.ts";
import type serviceTypes from "../src/core/pr-watch/service.types.ts";
import type snapshotTypes from "../src/core/pr-watch/snapshot.types.ts";
import summary from "../src/core/pr-watch/summary.ts";
import type watchTypes from "../src/core/pr-watch/watch.types.ts";
const { describePrWatchIndicator } = summary;

const { awaited, pollUntil, runTest, sleep } = testing;

const TICK_MS = 20;
const STATUS_INTERVAL_MS = 300_000;

const snapshotOf = (
  overrides: Partial<snapshotTypes.PrSnapshot> = {},
): snapshotTypes.PrSnapshot => ({
  baseRefName: "main",
  behindBy: undefined,
  checks: { failed: 0, passed: 0, pending: 2, pendingNames: ["verify"], total: 2 },
  comments: 0,
  headRefOid: "head-oid",
  mergeStateStatus: "CLEAN",
  mergeable: "MERGEABLE",
  reviewDecision: "REVIEW_REQUIRED",
  state: "OPEN",
  updatedAt: "2024-05-01T00:00:00Z",
  ...overrides,
});

const pendingChecks = snapshotOf();

interface ScriptedGh {
  readonly gh: ghTypes.PrWatchGh;
  readonly calls: { count: number };
}

const scriptedGh = (
  steps: ReadonlyArray<snapshotTypes.PrSnapshot | ghTypes.PrWatchGhError>,
): ScriptedGh => {
  const calls = { count: 0 };
  return {
    calls,
    gh: {
      behind: () => Effect.succeed(0),
      view: () => {
        const step = steps[Math.min(calls.count, steps.length - 1)]!;
        calls.count += 1;
        return step instanceof PrWatchGhError ? Effect.fail(step) : Effect.succeed(step);
      },
    },
  };
};

const neverGh: ghTypes.PrWatchGh = { behind: () => Effect.never, view: () => Effect.never };

interface HostLog {
  readonly host: watchTypes.PrWatchHost;
  readonly notifications: watchTypes.PrNotification[];
}

const createHost = (): HostLog => {
  const notifications: watchTypes.PrNotification[] = [];
  return {
    host: {
      changed: () => undefined,
      notify: (notification) => {
        notifications.push(notification);
      },
    },
    notifications,
  };
};

const waitFor = (predicate: () => boolean): Effect.Effect<void> =>
  pollUntil(Effect.sync(predicate), 600, 5);

const findEntry = (service: serviceTypes.PrWatch, number: number) =>
  service.snapshot().entries.find((entry) => entry.key === `#${number}`);

const withService = <A>(
  gh: ghTypes.PrWatchGh,
  host: HostLog,
  use: (service: serviceTypes.PrWatch) => Effect.Effect<A>,
): Promise<A> =>
  runTest(
    Effect.acquireUseRelease(
      Effect.sync(
        () =>
          new PrWatch({
            defaultIntervalMs: () => TICK_MS,
            gh,
            host: host.host,
            statusIntervalMs: () => STATUS_INTERVAL_MS,
          }),
      ),
      use,
      (service) => awaited(service.dispose()),
    ),
  );

const keepsOneWatchPerPullRequest = () => {
  const script = scriptedGh([pendingChecks]);
  return withService(script.gh, createHost(), (service) =>
    Effect.gen(function* () {
      const first = service.watch({ number: 12 });
      const second = service.watch({ number: 12 });
      expect(first.started).toBe(true);
      expect(second.started).toBe(false);
      expect(service.snapshot().entries).toHaveLength(1);
      yield* waitFor(() => script.calls.count >= 3);
      const before = script.calls.count;
      yield* sleep(TICK_MS * 3);
      const after = script.calls.count;
      expect(after - before).toBeLessThanOrEqual(4);
      expect(findEntry(service, 12)?.polls).toBe(after);
    }),
  );
};

const stopsAStoppedPullRequest = () => {
  const script = scriptedGh([pendingChecks]);
  return withService(script.gh, createHost(), (service) =>
    Effect.gen(function* () {
      service.watch({ number: 12 });
      yield* waitFor(() => script.calls.count >= 2);
      expect(service.stop({ number: 12 })).toBe(true);
      const stopped = script.calls.count;
      yield* sleep(TICK_MS * 4);
      expect(script.calls.count).toBe(stopped);
      expect(findEntry(service, 12)).toBeUndefined();
      expect(service.snapshot().entries).toEqual([]);
      expect(service.stop({ number: 12 })).toBe(false);
    }),
  );
};

const stopsEveryWatchWhenTheSessionEnds = () => {
  const script = scriptedGh([pendingChecks]);
  return withService(script.gh, createHost(), (service) =>
    Effect.gen(function* () {
      service.watch({ number: 12 });
      service.watch({ number: 13, repository: "masseater/msa" });
      yield* waitFor(() => script.calls.count >= 2);
      yield* awaited(service.dispose());
      const stopped = script.calls.count;
      yield* sleep(TICK_MS * 4);
      expect(script.calls.count).toBe(stopped);
      expect(service.snapshot().entries).toEqual([]);
    }),
  );
};

const reportsEachChangeOnce = () => {
  const script = scriptedGh([pendingChecks, snapshotOf({ state: "MERGED" })]);
  const host = createHost();
  return withService(script.gh, host, (service) =>
    Effect.gen(function* () {
      service.watch({ number: 12 });
      yield* waitFor(() => host.notifications.length > 0);
      yield* sleep(TICK_MS * 3);
      expect(host.notifications).toHaveLength(1);
      expect(host.notifications[0]?.label).toBe("merged");
      expect(service.snapshot().last).toEqual({ change: "merged", key: "#12", target: "#12" });
      expect(findEntry(service, 12)?.status).toBe("stopped");
    }),
  );
};

const showsAWatchedPullRequestInTheFooter = () => {
  const script = scriptedGh([
    snapshotOf({ checks: { failed: 1, passed: 2, pending: 0, pendingNames: [], total: 2 } }),
  ]);
  return withService(script.gh, createHost(), (service) =>
    Effect.gen(function* () {
      service.watch({ number: 12, repository: "masseater/msa" });
      yield* waitFor(
        () =>
          service.snapshot().entries.find((entry) => entry.key === "masseater/msa#12")?.snapshot !==
          undefined,
      );
      expect(describePrWatchIndicator(service.snapshot())).toBe("PR masseater/msa#12 1 failed");
    }),
  );
};

const showsABaseMoveInTheFooter = () => {
  const behind = snapshotOf({ mergeStateStatus: "BEHIND" });
  const gh: ghTypes.PrWatchGh = {
    behind: () => Effect.succeed(3),
    view: () => Effect.succeed(behind),
  };
  return withService(gh, createHost(), (service) =>
    Effect.gen(function* () {
      service.watch({ number: 12 });
      yield* waitFor(() => findEntry(service, 12)?.snapshot?.behindBy === 3);
      expect(describePrWatchIndicator(service.snapshot())).toBe("PR #12 base 3 behind");
    }),
  );
};

const showsABrokenReadAsAGhError = () => {
  const missing = new PrWatchGhError({ kind: "missing", message: "gh is not on PATH" });
  const host = createHost();
  return withService(scriptedGh([missing]).gh, host, (service) =>
    Effect.gen(function* () {
      service.watch({ number: 12 });
      yield* waitFor(() => host.notifications.length > 0);
      expect(describePrWatchIndicator(service.snapshot())).toBe(
        "PR #12 gh error · last #12 watch stopped",
      );
    }),
  );
};

const doesNotWaitForTheFirstRead = () =>
  withService(neverGh, createHost(), (service) =>
    Effect.sync(() => {
      const outcome = service.watch({ number: 12 });
      expect(outcome.started).toBe(true);
      expect(outcome.entry.snapshot).toBeUndefined();
      expect(outcome.entry.polls).toBe(0);
    }),
  );

describe("pull request watches", () => {
  it("keeps one watch when the same pull request is registered twice", keepsOneWatchPerPullRequest);
  it("stops checking a pull request that was stopped", stopsAStoppedPullRequest);
  it("stops every watch when the session ends", stopsEveryWatchWhenTheSessionEnds);
  it("reports each change once and remembers the last notification", reportsEachChangeOnce);
  it("shows a watched pull request in the footer line", showsAWatchedPullRequestInTheFooter);
  it("shows a base move in the footer line", showsABaseMoveInTheFooter);
  it("shows a broken read as a gh error in the footer line", showsABrokenReadAsAGhError);
  it("does not wait for the first read", doesNotWaitForTheFirstRead);
});
