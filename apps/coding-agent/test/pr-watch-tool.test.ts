import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { PrWatchGh } from "../src/core/pr-watch/gh.ts";
import { PrWatch } from "../src/core/pr-watch/service.ts";
import { createPrWatchHost, PR_WATCH_MESSAGE_TYPE } from "../src/core/pr-watch/session-host.ts";
import type { PrSnapshot } from "../src/core/pr-watch/snapshot.ts";
import type { PrNotification, PrWatchHost } from "../src/core/pr-watch/watch.ts";
import { createPrWatchToolDefinition } from "../src/core/tools/pr-watch.ts";

const STATUS_INTERVAL_MS = 300_000;

const snapshotOf = (overrides: Partial<PrSnapshot> = {}): PrSnapshot => ({
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: "REVIEW_REQUIRED",
  updatedAt: "2024-05-01T00:00:00Z",
  comments: 0,
  checks: { total: 2, passed: 0, failed: 0, pending: 2, pendingNames: ["verify"] },
  baseRefName: "main",
  headRefOid: "head-oid",
  behindBy: undefined,
  ...overrides,
});

const pendingChecks = snapshotOf();

const neverGh: PrWatchGh = { view: () => Effect.never, behind: () => Effect.never };

const createHost = (): { host: PrWatchHost; notifications: PrNotification[] } => {
  const notifications: PrNotification[] = [];
  return {
    notifications,
    host: {
      notify: (notification) => {
        notifications.push(notification);
      },
      changed: () => undefined,
    },
  };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 3000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const createService = (
  gh: PrWatchGh,
  host: ReturnType<typeof createHost>,
  intervalMs: number,
): PrWatch =>
  new PrWatch({
    gh,
    host: host.host,
    defaultIntervalMs: () => intervalMs,
    statusIntervalMs: () => STATUS_INTERVAL_MS,
  });

const textOf = (result: { content: readonly { type: string; text?: string }[] }): string =>
  result.content.map((part) => part.text ?? "").join("");

const run = (
  tool: ReturnType<typeof createPrWatchToolDefinition>,
  params: Parameters<ReturnType<typeof createPrWatchToolDefinition>["execute"]>[1],
) => tool.execute("call-1", params, undefined, undefined, undefined as never);

describe("pr_watch tool", () => {
  it("answers at once while the watch runs in the background", async () => {
    const host = createHost();
    const service = createService(neverGh, host, 45_000);
    try {
      const tool = createPrWatchToolDefinition(service);
      const result = await run(tool, { action: "watch", number: 12 });

      expect(textOf(result)).toBe("Watching #12 every 45s");
      expect(service.snapshot().entries[0]?.status).toBe("watching");
    } finally {
      await service.dispose();
    }
  });

  it("takes the interval from the call", async () => {
    const host = createHost();
    const service = createService(neverGh, host, 45_000);
    try {
      const result = await run(createPrWatchToolDefinition(service), {
        action: "watch",
        number: 12,
        intervalSeconds: 10,
      });

      expect(textOf(result)).toBe("Watching #12 every 10s");
    } finally {
      await service.dispose();
    }
  });

  it("registers the same pull request once", async () => {
    const host = createHost();
    const service = createService(neverGh, host, 45_000);
    try {
      const tool = createPrWatchToolDefinition(service);
      await run(tool, { action: "watch", number: 12 });
      const again = await run(tool, { action: "watch", number: 12 });

      expect(textOf(again)).toBe("Already watching #12 every 45s");
      expect(service.snapshot().entries).toHaveLength(1);
    } finally {
      await service.dispose();
    }
  });

  it("stops a watch", async () => {
    const host = createHost();
    const service = createService(neverGh, host, 45_000);
    try {
      const tool = createPrWatchToolDefinition(service);
      await run(tool, { action: "watch", number: 12 });

      expect(textOf(await run(tool, { action: "stop", number: 12 }))).toBe("Stopped watching #12");
      expect(textOf(await run(tool, { action: "stop", number: 12 }))).toBe("Not watching #12");
    } finally {
      await service.dispose();
    }
  });

  it("lists the watches with their last state and notification", async () => {
    const failed = snapshotOf({
      checks: { total: 2, passed: 1, failed: 1, pending: 0, pendingNames: [] },
    });
    let polls = 0;
    const gh: PrWatchGh = {
      view: () => {
        polls += 1;
        return Effect.succeed(polls === 1 ? pendingChecks : failed);
      },
      behind: () => Effect.succeed(0),
    };
    const host = createHost();
    const service = createService(gh, host, 500);
    try {
      const tool = createPrWatchToolDefinition(service);
      await run(tool, { action: "watch", number: 12 });
      await waitFor(() => host.notifications.length > 0);

      expect(textOf(await run(tool, { action: "list" }))).toBe(
        ["Watching 1 pull request", "#12 · 1 failed · every 1s · last: CI failed"].join("\n"),
      );
    } finally {
      await service.dispose();
    }
  });

  it("lists nothing when no pull request is watched", async () => {
    const host = createHost();
    const service = createService(neverGh, host, 45_000);
    try {
      expect(textOf(await run(createPrWatchToolDefinition(service), { action: "list" }))).toBe(
        "No pull requests watched",
      );
    } finally {
      await service.dispose();
    }
  });

  it("rejects a watch without a pull request number", async () => {
    const host = createHost();
    const service = createService(neverGh, host, 45_000);
    try {
      await expect(run(createPrWatchToolDefinition(service), { action: "watch" })).rejects.toThrow(
        "action watch requires a pull request number",
      );
    } finally {
      await service.dispose();
    }
  });
});

describe("pr_watch delivery", () => {
  it("sends a change as a message that starts a turn when the session is idle", () => {
    const sent: Array<{ message: unknown; options: unknown }> = [];
    const host = createPrWatchHost({
      threadId: "01a1518a-ff46-75e6-90be-7024913caa86",
      sendMessage: (message, options) => {
        sent.push({ message, options });
      },
      changed: () => undefined,
    });

    host.notify({
      label: "CI failed",
      text: "#12: CI finished: 1 failed. Fix the failing checks.",
      wake: true,
    });

    expect(sent).toEqual([
      {
        message: {
          customType: PR_WATCH_MESSAGE_TYPE,
          content: "#12: CI finished: 1 failed. Fix the failing checks. [01a1518a]",
          display: true,
        },
        options: { triggerTurn: true, deliverAs: "steer" },
      },
    ]);
  });

  it("sends a status report without starting a turn", () => {
    const sent: Array<{ message: unknown; options: unknown }> = [];
    const host = createPrWatchHost({
      threadId: "01a1518a-ff46-75e6-90be-7024913caa86",
      sendMessage: (message, options) => {
        sent.push({ message, options });
      },
      changed: () => undefined,
    });

    host.notify({ label: "status", text: "#12: checks running (verify), mergeable", wake: false });

    expect(sent).toEqual([
      {
        message: {
          customType: PR_WATCH_MESSAGE_TYPE,
          content: "#12: checks running (verify), mergeable [01a1518a]",
          display: true,
        },
        options: { triggerTurn: false, deliverAs: "steer" },
      },
    ]);
  });

  it("tags the same text from two threads with their own id", () => {
    const content = (threadId: string) => {
      const sent: Array<{ message: { content: string } }> = [];
      createPrWatchHost({
        threadId,
        sendMessage: (message) => {
          sent.push({ message });
        },
        changed: () => undefined,
      }).notify({ label: "status", text: "#12: checks running", wake: false });
      return sent[0]?.message.content;
    };

    expect(content("aaaaaaaa-0000-0000-0000-000000000001")).toBe("#12: checks running [aaaaaaaa]");
    expect(content("bbbbbbbb-0000-0000-0000-000000000002")).toBe("#12: checks running [bbbbbbbb]");
  });
});
