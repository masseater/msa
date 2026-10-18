import { describe, expect, it } from "vite-plus/test";

import { PrWatch } from "../src/core/pr-watch/service.ts";
import { createPrWatchHost, PR_WATCH_MESSAGE_TYPE } from "../src/core/pr-watch/session-host.ts";
import { createPrWatchToolDefinition } from "../src/core/tools/pr-watch.ts";
import {
  createHost,
  neverGh,
  pendingChecks,
  scriptedGh,
  snapshotOf,
  waitFor,
} from "./pr-watch-support.ts";

const textOf = (result: { content: readonly { type: string; text?: string }[] }): string =>
  result.content.map((part) => part.text ?? "").join("");

const createTool = (service: PrWatch): ReturnType<typeof createPrWatchToolDefinition> =>
  createPrWatchToolDefinition(service);

const run = (
  tool: ReturnType<typeof createPrWatchToolDefinition>,
  params: Parameters<ReturnType<typeof createPrWatchToolDefinition>["execute"]>[1],
) => tool.execute("call-1", params, undefined, undefined, undefined as never);

describe("pr_watch tool", () => {
  it("answers at once while the watch runs in the background", async () => {
    const host = createHost();
    const service = new PrWatch({
      gh: neverGh(),
      host: host.host,
      defaultIntervalMs: () => 45_000,
    });
    try {
      const tool = createTool(service);
      const result = await run(tool, { action: "watch", number: 12 });

      expect(textOf(result)).toBe("Watching #12 every 45s");
      expect(service.snapshot().entries[0]?.status).toBe("watching");
    } finally {
      await service.dispose();
    }
  });

  it("takes the interval from the call", async () => {
    const host = createHost();
    const service = new PrWatch({
      gh: neverGh(),
      host: host.host,
      defaultIntervalMs: () => 45_000,
    });
    try {
      const result = await run(createTool(service), {
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
    const service = new PrWatch({
      gh: neverGh(),
      host: host.host,
      defaultIntervalMs: () => 45_000,
    });
    try {
      const tool = createTool(service);
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
    const service = new PrWatch({
      gh: neverGh(),
      host: host.host,
      defaultIntervalMs: () => 45_000,
    });
    try {
      const tool = createTool(service);
      await run(tool, { action: "watch", number: 12 });

      expect(textOf(await run(tool, { action: "stop", number: 12 }))).toBe("Stopped watching #12");
      expect(textOf(await run(tool, { action: "stop", number: 12 }))).toBe("Not watching #12");
    } finally {
      await service.dispose();
    }
  });

  it("lists the watches with their last state and notification", async () => {
    const failed = snapshotOf({ checks: { total: 2, passed: 1, failed: 1, pending: 0 } });
    const script = scriptedGh([pendingChecks, failed]);
    const host = createHost();
    const service = new PrWatch({ gh: script.gh, host: host.host, defaultIntervalMs: () => 500 });
    try {
      const tool = createTool(service);
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
    const service = new PrWatch({
      gh: neverGh(),
      host: host.host,
      defaultIntervalMs: () => 45_000,
    });
    try {
      expect(textOf(await run(createTool(service), { action: "list" }))).toBe(
        "No pull requests watched",
      );
    } finally {
      await service.dispose();
    }
  });

  it("rejects a watch without a pull request number", async () => {
    const host = createHost();
    const service = new PrWatch({
      gh: neverGh(),
      host: host.host,
      defaultIntervalMs: () => 45_000,
    });
    try {
      await expect(run(createTool(service), { action: "watch" })).rejects.toThrow(
        "action watch requires a pull request number",
      );
    } finally {
      await service.dispose();
    }
  });
});

describe("pr_watch delivery", () => {
  it("sends the notification as a message that starts a turn when the session is idle", () => {
    const sent: Array<{ message: unknown; options: unknown }> = [];
    const host = createPrWatchHost({
      sendMessage: (message, options) => {
        sent.push({ message, options });
      },
      changed: () => undefined,
    });

    host.notify({
      label: "CI failed",
      text: "#12: CI finished: 1 failed. Fix the failing checks.",
    });

    expect(sent).toEqual([
      {
        message: {
          customType: PR_WATCH_MESSAGE_TYPE,
          content: "#12: CI finished: 1 failed. Fix the failing checks.",
          display: true,
        },
        options: { triggerTurn: true, deliverAs: "steer" },
      },
    ]);
  });
});
