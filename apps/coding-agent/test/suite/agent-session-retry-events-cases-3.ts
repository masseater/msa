import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import agentSessionRetryEventsCases1 from "./agent-session-retry-events-cases-1.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage } = ai;

const { createHarness } = harnessModule;
const { harnesses } = agentSessionRetryEventsCases1;

const { gate } = testing;

const emitsAgentEndForAbortedRuns = Effect.gen(function* () {
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

  const promptPromise = harness.session.run.prompting.prompt("hi");
  yield* Effect.promise(() => sawMessageUpdate);
  yield* Effect.promise(() => harness.session.run.lifecycle.abort());
  yield* Effect.promise(() => promptPromise);

  expect(harness.eventsOfType("agent_end")).toHaveLength(1);
  expect(harness.events[harness.events.length - 1]?.type).toBe("agent_settled");
  const lastMessage = harness.session.messages[harness.session.messages.length - 1];
  expect(lastMessage?.role).toBe("assistant");
  if (lastMessage?.role === "assistant") {
    expect(lastMessage.stopReason).toBe("aborted");
  }
});

const agentSessionRetryEventsCases3 = {
  emitsAgentEndForAbortedRuns,
};

export default agentSessionRetryEventsCases3;
