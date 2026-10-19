import { fauxAssistantMessage } from "@msa/ai";
import { gate } from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import { harnesses } from "./agent-session-retry-events-cases-1.ts";
import { createHarness } from "./harness.ts";

export const emitsAgentEndForAbortedRuns = Effect.gen(function* () {
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

  expect(harness.eventsOfType("agent_end")).toHaveLength(1);
  expect(harness.events[harness.events.length - 1]?.type).toBe("agent_settled");
  const lastMessage = harness.session.messages[harness.session.messages.length - 1];
  expect(lastMessage?.role).toBe("assistant");
  if (lastMessage?.role === "assistant") {
    expect(lastMessage.stopReason).toBe("aborted");
  }
});
