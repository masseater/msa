import { fauxAssistantMessage, fauxText } from "@msa/ai";
import { LiveDoc } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { listen, drained } from "./harness-events-support.ts";
import { chatSetup, openChat, waitFor, awaited, context } from "./support.ts";

const startsMessageFirst = Effect.gen(function* () {
  const setup = chatSetup({ tokensPerSecond: 100, tokenSize: { min: 1, max: 1 } });
  setup.faux.setResponses([fauxAssistantMessage([fauxText("x".repeat(400))])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const { stream, events } = yield* listen(harness, root);
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  yield* waitFor(() =>
    events().some((event) => event.type === "message_start" && event.message.role === "assistant"),
  );
  const live = yield* awaited(harness.snapshot(LiveDoc, root.id, context));
  yield* awaited(harness.abortTask(live!.run!.taskId, context));
  yield* awaited(submission.wait(context));
  yield* drained();
  const assistantEnds = events().filter(
    (event) => event.type === "message_end" && event.entry?.kind === "msa.assistant",
  );
  expect(assistantEnds).toHaveLength(1);
  expect(
    events().filter(
      (event) => event.type === "message_start" && event.message.role === "assistant",
    ),
  ).toHaveLength(1);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("agent events", () => {
  it("starts a message at the first committed partial and ends it with the converted entry on abort", () =>
    Effect.runPromise(startsMessageFirst));
});
