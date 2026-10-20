import { fauxAssistantMessage } from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { AssistantMessage } from "../../../../../libs/ai/src/message-types.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];

const allowsExtensionsToReplaceFinalizedAssistant = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("message_end", (event) => {
            if (event.message.role !== "assistant") return;

            return {
              message: {
                ...event.message,
                usage: {
                  ...event.message.usage,
                  cost: {
                    ...event.message.usage.cost,
                    total: 0.123,
                  },
                },
              },
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("hello")]);
  yield* Effect.promise(() => harness.session.prompt("hi"));
  const assistantMessage = harness.session.messages.find((message) => message.role === "assistant");
  return yield* allowsExtensionsToReplaceFinalizedAssistantStep1(harness, assistantMessage);
});

const allowsExtensionsToReplaceFinalizedAssistantStep1 = (
  harness: harnessTypes.Harness,
  assistantMessage: AssistantMessage | undefined,
) =>
  Effect.sync(() => {
    expect(assistantMessage?.role).toBe("assistant");
    if (assistantMessage?.role !== "assistant") {
      throw new Error("missing assistant message");
    }
    expect(assistantMessage.usage.cost.total).toBe(0.123);
    const messageEnd = harness
      .eventsOfType("message_end")
      .find((event) => event.message.role === "assistant");
    expect(messageEnd?.message.role).toBe("assistant");
    if (messageEnd?.message.role !== "assistant") {
      throw new Error("missing assistant message_end event");
    }
    expect(messageEnd.message.usage.cost.total).toBe(0.123);
  });

const allowsExtensionsToReplaceFinalizedAssistantUsage = () =>
  Effect.runPromise(allowsExtensionsToReplaceFinalizedAssistant);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("regression #3982: message_end cost override", () => {
  afterEach(afterEachHook);
  it(
    "allows extensions to replace finalized assistant usage cost",
    allowsExtensionsToReplaceFinalizedAssistantUsage,
  );
});
