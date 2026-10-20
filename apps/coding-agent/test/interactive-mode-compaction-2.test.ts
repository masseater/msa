import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import InteractiveMode from "../src/modes/interactive/interactive-mode.ts";

const { awaited, runTest } = testing;

const routesInteractiveResponseAbortsThroughAgentsession = () => {
  const abort = vi.fn(() => runTest(Effect.sync(() => {})));
  const ui = {
    clearAllQueues: () => ({ followUp: [], steering: [] }),
    session: { run: { lifecycle: { abort } } },
    updatePendingMessagesDisplay: vi.fn(),
  };
  const restoreQueuedMessagesToEditor = Reflect.get(
    InteractiveMode.prototype,
    "restoreQueuedMessagesToEditor",
  ) as (this: typeof ui, options?: { abort?: boolean }) => number;

  Object.setPrototypeOf(ui, InteractiveMode.prototype);
  restoreQueuedMessagesToEditor.call(ui, { abort: true });

  expect(abort).toHaveBeenCalledOnce();
};

const preservesSteeringBehaviorWhenFlushingIntoAn = () =>
  runTest(
    Effect.gen(function* () {
      const fakeThis = {
        compactionQueuedMessages: [{ mode: "steer" as const, text: "change direction" }],
        isExtensionCommand: vi.fn().mockReturnValue(false),
        session: {
          run: {
            prompting: { prompt: vi.fn().mockResolvedValue(undefined) },
            queue: {
              clearQueue: vi.fn(),
              followUp: vi.fn().mockResolvedValue(undefined),
              steer: vi.fn().mockResolvedValue(undefined),
            },
          },
        },
        showError: vi.fn(),
        updatePendingMessagesDisplay: vi.fn(),
      };

      const flushCompactionQueue = Reflect.get(
        InteractiveMode.prototype,
        "flushCompactionQueue",
      ) as (this: typeof fakeThis, options?: { willRetry?: boolean }) => Promise<void>;

      Object.setPrototypeOf(fakeThis, InteractiveMode.prototype);
      yield* awaited(flushCompactionQueue.call(fakeThis, { willRetry: false }));

      expect(fakeThis.session.run.prompting.prompt).toHaveBeenCalledWith("change direction", {
        streamingBehavior: "steer",
      });
      expect(fakeThis.compactionQueuedMessages).toEqual([]);
      expect(fakeThis.showError).not.toHaveBeenCalled();
    }),
  );

describe("InteractiveMode compaction events", () => {
  test(
    "routes interactive response aborts through AgentSession",
    routesInteractiveResponseAbortsThroughAgentsession,
  );

  test(
    "preserves steering behavior when flushing into an active agent run",
    preservesSteeringBehaviorWhenFlushingIntoAn,
  );
});
