import { fauxAssistantMessage } from "@msa/ai";
import { gate } from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";
import { createHarness } from "./harness.ts";
import { harnesses } from "./agent-session-bash-persistence-cases-1.ts";

export const persistsAbortedAssistantMessages = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("x".repeat(20_000))]);

  const sawMessageUpdate = gate();
  {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "message_update") {
        unsubscribe();
        sawMessageUpdate.release();
      }
    });
  }

  const promptPromise = harness.session.prompt("hi");
  yield* Effect.promise(() => sawMessageUpdate);
  yield* Effect.promise(() => harness.session.abort());
  yield* Effect.promise(() => promptPromise);

  const lastEntry =
    harness.sessionManager.getEntries()[harness.sessionManager.getEntries().length - 1];
  expect(lastEntry?.type).toBe("message");
  if (lastEntry?.type === "message") {
    expect(lastEntry.message.role).toBe("assistant");
    if (lastEntry.message.role === "assistant") {
      expect(lastEntry.message.stopReason).toBe("aborted");
    }
  }
});
