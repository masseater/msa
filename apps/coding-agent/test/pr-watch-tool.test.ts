import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type ghTypes from "../src/core/pr-watch/gh.types.ts";
import PrWatch from "../src/core/pr-watch/service.ts";
import type serviceTypes from "../src/core/pr-watch/service.types.ts";
import type snapshotTypes from "../src/core/pr-watch/snapshot.types.ts";
import type watchTypes from "../src/core/pr-watch/watch.types.ts";
import prWatch from "../src/core/tools/pr-watch.ts";

const { createPrWatchToolDefinition } = prWatch;
const { awaited, pollUntil, runTest } = testing;

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

const neverGh: ghTypes.PrWatchGh = { behind: () => Effect.never, view: () => Effect.never };

const createHost = (): {
  host: watchTypes.PrWatchHost;
  notifications: watchTypes.PrNotification[];
} => {
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

type PrWatchTool = ReturnType<typeof createPrWatchToolDefinition>;

const textOf = (result: { content: readonly { type: string; text?: string }[] }): string =>
  result.content.map((part) => part.text ?? "").join("");

const withTool = <A>(
  use: (tool: PrWatchTool, service: serviceTypes.PrWatch) => Effect.Effect<A>,
  options: {
    gh?: ghTypes.PrWatchGh;
    host?: ReturnType<typeof createHost>;
    intervalMs?: number;
  } = {},
): Promise<A> =>
  runTest(
    Effect.acquireUseRelease(
      Effect.sync(
        () =>
          new PrWatch({
            defaultIntervalMs: () => options.intervalMs ?? 45_000,
            gh: options.gh ?? neverGh,
            host: (options.host ?? createHost()).host,
            statusIntervalMs: () => STATUS_INTERVAL_MS,
          }),
      ),
      (service) => use(createPrWatchToolDefinition(service), service),
      (service) => awaited(service.dispose()),
    ),
  );

const run = (tool: PrWatchTool, params: Parameters<PrWatchTool["execute"]>[1]) =>
  awaited(tool.execute("call-1", params, undefined, undefined, undefined as never)).pipe(
    Effect.map(textOf),
  );

const answersAtOnceWhileTheWatchRuns = () =>
  withTool((tool, service) =>
    Effect.gen(function* () {
      expect(yield* run(tool, { action: "watch", number: 12 })).toBe("Watching #12 every 45s");
      expect(service.snapshot().entries[0]?.status).toBe("watching");
    }),
  );

const takesTheIntervalFromTheCall = () =>
  withTool((tool) =>
    Effect.gen(function* () {
      expect(yield* run(tool, { action: "watch", intervalSeconds: 10, number: 12 })).toBe(
        "Watching #12 every 10s",
      );
    }),
  );

const registersTheSamePullRequestOnce = () =>
  withTool((tool, service) =>
    Effect.gen(function* () {
      yield* run(tool, { action: "watch", number: 12 });
      expect(yield* run(tool, { action: "watch", number: 12 })).toBe(
        "Already watching #12 every 45s",
      );
      expect(service.snapshot().entries).toHaveLength(1);
    }),
  );

const stopsAWatch = () =>
  withTool((tool) =>
    Effect.gen(function* () {
      yield* run(tool, { action: "watch", number: 12 });
      expect(yield* run(tool, { action: "stop", number: 12 })).toBe("Stopped watching #12");
      expect(yield* run(tool, { action: "stop", number: 12 })).toBe("Not watching #12");
    }),
  );

const listsTheWatchesWithTheirLastState = () => {
  const failed = snapshotOf({
    checks: { failed: 1, passed: 1, pending: 0, pendingNames: [], total: 2 },
  });
  let polls = 0;
  const gh: ghTypes.PrWatchGh = {
    behind: () => Effect.succeed(0),
    view: () => {
      polls += 1;
      return Effect.succeed(polls === 1 ? pendingChecks : failed);
    },
  };
  const host = createHost();
  return withTool(
    (tool) =>
      Effect.gen(function* () {
        yield* run(tool, { action: "watch", number: 12 });
        yield* waitFor(() => host.notifications.length > 0);
        expect(yield* run(tool, { action: "list" })).toBe(
          ["Watching 1 pull request", "#12 · 1 failed · every 1s · last: CI failed"].join("\n"),
        );
      }),
    { gh, host, intervalMs: 500 },
  );
};

const listsNothingWhenNoPullRequestIs = () =>
  withTool((tool) =>
    Effect.gen(function* () {
      expect(yield* run(tool, { action: "list" })).toBe("No pull requests watched");
    }),
  );

const rejectsAWatchWithoutAPullRequest = () =>
  withTool((tool) =>
    awaited(
      expect(
        tool.execute("call-1", { action: "watch" }, undefined, undefined, undefined as never),
      ).rejects.toThrow("action watch requires a pull request number"),
    ),
  );

describe("pr_watch tool", () => {
  it("answers at once while the watch runs in the background", answersAtOnceWhileTheWatchRuns);
  it("takes the interval from the call", takesTheIntervalFromTheCall);
  it("registers the same pull request once", registersTheSamePullRequestOnce);
  it("stops a watch", stopsAWatch);
  it("lists the watches with their last state and notification", listsTheWatchesWithTheirLastState);
  it("lists nothing when no pull request is watched", listsNothingWhenNoPullRequestIs);
  it("rejects a watch without a pull request number", rejectsAWatchWithoutAPullRequest);
});
