import { describe, expect, it } from "vite-plus/test";

import { PrWatchGhError } from "../src/core/pr-watch/gh.ts";
import { PrWatch } from "../src/core/pr-watch/service.ts";
import { describePrWatchIndicator } from "../src/core/pr-watch/summary.ts";
import {
  createHost,
  type HostLog,
  neverGh,
  pendingChecks,
  scriptedGh,
  sleep,
  snapshotOf,
  STATUS_INTERVAL_MS,
  waitFor,
} from "./pr-watch-support.ts";

const TICK_MS = 20;

const findEntry = (service: PrWatch, number: number) =>
  service.snapshot().entries.find((entry) => entry.key === `#${number}`);

const createService = (
  gh: ReturnType<typeof scriptedGh>["gh"],
  host: HostLog,
  intervalMs = TICK_MS,
): PrWatch =>
  new PrWatch({
    gh,
    host: host.host,
    defaultIntervalMs: () => intervalMs,
    statusIntervalMs: () => STATUS_INTERVAL_MS,
  });

describe("pull request watches", () => {
  it("keeps one watch when the same pull request is registered twice", async () => {
    const script = scriptedGh([pendingChecks]);
    const host = createHost();
    const service = createService(script.gh, host);
    try {
      const first = service.watch({ number: 12 });
      const second = service.watch({ number: 12 });

      expect(first.started).toBe(true);
      expect(second.started).toBe(false);
      expect(service.snapshot().entries).toHaveLength(1);

      await waitFor(() => script.calls.count >= 3);
      const before = script.calls.count;
      await sleep(TICK_MS * 3);
      const after = script.calls.count;

      expect(after - before).toBeLessThanOrEqual(4);
      expect(findEntry(service, 12)?.polls).toBe(after);
    } finally {
      await service.dispose();
    }
  });

  it("stops checking a pull request that was stopped", async () => {
    const script = scriptedGh([pendingChecks]);
    const host = createHost();
    const service = createService(script.gh, host);
    try {
      service.watch({ number: 12 });
      await waitFor(() => script.calls.count >= 2);

      expect(service.stop({ number: 12 })).toBe(true);
      const stopped = script.calls.count;
      await sleep(TICK_MS * 4);

      expect(script.calls.count).toBe(stopped);
      expect(findEntry(service, 12)).toBeUndefined();
      expect(service.snapshot().entries).toEqual([]);
      expect(service.stop({ number: 12 })).toBe(false);
    } finally {
      await service.dispose();
    }
  });

  it("stops every watch when the session ends", async () => {
    const script = scriptedGh([pendingChecks]);
    const host = createHost();
    const service = createService(script.gh, host);
    service.watch({ number: 12 });
    service.watch({ number: 13, repository: "masseater/msa" });
    await waitFor(() => script.calls.count >= 2);

    await service.dispose();
    const stopped = script.calls.count;
    await sleep(TICK_MS * 4);

    expect(script.calls.count).toBe(stopped);
    expect(service.snapshot().entries).toEqual([]);
  });

  it("reports each change once and remembers the last notification", async () => {
    const merged = snapshotOf({ state: "MERGED" });
    const script = scriptedGh([pendingChecks, merged]);
    const host = createHost();
    const service = createService(script.gh, host);
    try {
      service.watch({ number: 12 });
      await waitFor(() => host.notifications.length > 0);
      await sleep(TICK_MS * 3);

      expect(host.notifications).toHaveLength(1);
      expect(host.notifications[0]?.label).toBe("merged");
      expect(service.snapshot().last).toEqual({ key: "#12", target: "#12", change: "merged" });
      expect(findEntry(service, 12)?.status).toBe("stopped");
    } finally {
      await service.dispose();
    }
  });

  it("shows a watched pull request in the footer line", async () => {
    const script = scriptedGh([
      snapshotOf({ checks: { total: 2, passed: 2, failed: 1, pending: 0, pendingNames: [] } }),
    ]);
    const host = createHost();
    const service = createService(script.gh, host);
    try {
      const target = { number: 12, repository: "masseater/msa" };
      service.watch(target);
      await waitFor(
        () =>
          service.snapshot().entries.find((entry) => entry.key === "masseater/msa#12")?.snapshot !==
          undefined,
      );

      expect(describePrWatchIndicator(service.snapshot())).toBe("PR masseater/msa#12 1 failed");
    } finally {
      await service.dispose();
    }
  });

  it("shows a broken read as a gh error in the footer line", async () => {
    const missing = new PrWatchGhError({ kind: "missing", message: "gh is not on PATH" });
    const script = scriptedGh([missing]);
    const host = createHost();
    const service = createService(script.gh, host);
    try {
      service.watch({ number: 12 });
      await waitFor(() => host.notifications.length > 0);

      expect(describePrWatchIndicator(service.snapshot())).toBe(
        "PR #12 gh error · last #12 watch stopped",
      );
    } finally {
      await service.dispose();
    }
  });

  it("does not wait for the first read", async () => {
    const host = createHost();
    const service = createService(neverGh(), host);
    try {
      const outcome = service.watch({ number: 12 });

      expect(outcome.started).toBe(true);
      expect(outcome.entry.snapshot).toBeUndefined();
      expect(outcome.entry.polls).toBe(0);
    } finally {
      await service.dispose();
    }
  });
});
