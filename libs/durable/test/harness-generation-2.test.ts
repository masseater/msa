import { fauxAssistantMessage } from "@msa/ai";
import { defineExtension, wrapSection } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addSection } from "./harness-support.ts";
import { context } from "./session-support.ts";

const reportsSectionWrapper = Effect.gen(function* () {
  const setup = chatSetup();
  addSection(setup.registry, "cwd", () => "/repo");
  setup.registry.install(
    defineExtension({
      name: "broken",
      wraps: [
        wrapSection("cwd", () => {
          throw new Error("wrapper failed");
        }),
      ],
    }),
  );
  setup.faux.setResponses([fauxAssistantMessage("ok")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  harness.resume();
  expect(
    (yield* awaited(
      (yield* awaited(root.submit({ type: "input", content: "hi" }, context))).wait(context),
    )).status,
  ).toBe("done");
  expect(setup.reports).toContainEqual(new Error("wrapper failed"));
  expect((yield* allEntries(root)).map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.assistant",
  ]);
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("reports section wrapper failures while preparing", () =>
    Effect.runPromise(reportsSectionWrapper));
});

const failsNonRetryable = Effect.gen(function* () {
  const setup = chatSetup();
  setup.faux.setResponses([
    fauxAssistantMessage([], { stopReason: "error", errorMessage: "Invalid request" }),
    fauxAssistantMessage("never"),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  harness.resume();
  const settled = yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "hi" }, context))).wait(context),
  );
  expect(settled).toMatchObject({
    status: "unanswered",
    reason: "model_error",
    detail: "Invalid request",
  });
  const tasks = yield* awaited(
    harness.commit((tx) => tx.scanTasks({ conversationId: root.id }, 10), context),
  );
  expect(tasks.items[0]!.state).toMatchObject({
    outcome: {
      status: "failed",
      error: { message: "Invalid request", detail: { reason: "model_error" } },
    },
  });
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("fails a non-retryable error without retrying", () => Effect.runPromise(failsNonRetryable));
});
