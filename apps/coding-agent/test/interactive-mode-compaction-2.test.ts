import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import interactiveModeFake from "./interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;

const { awaited, runTest } = testing;

const routesInteractiveResponseAbortsThroughAgentsession = () => {
  const abort = vi.fn(() => runTest(Effect.sync(() => {})));
  const ui = {
    clearAllQueues: () => ({ followUp: [], steering: [] }),
    session: { run: { lifecycle: { abort } } },
    updatePendingMessagesDisplay: vi.fn(),
  };
  bindModeFake(ui);
  bindModeFake(ui).input.queue.restoreQueuedMessagesToEditor({ abort: true });

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
      bindModeFake(fakeThis);
      yield* awaited(bindModeFake(fakeThis).input.queue.flushCompactionQueue({ willRetry: false }));

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
