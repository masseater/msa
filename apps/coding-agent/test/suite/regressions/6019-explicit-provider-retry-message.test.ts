import ai from "@msa/ai";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";

const { fauxAssistantMessage } = ai;

const { createHarness } = harnessModule;

const openAIExplicitRetryMessage =
  "An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID req_******** in your message.";
const bedrockExplicitRetryMessage =
  '{"message":"The system encountered an unexpected error during processing. Try your request again."}';

describe("regression: issue 6019 explicit provider retry messages", () => {
  it.each([
    ["openai", openAIExplicitRetryMessage],
    ["bedrock", bedrockExplicitRetryMessage],
  ])("retries %s explicit retry guidance", (_provider, errorMessage) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* Effect.promise(() =>
          createHarness({
            settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
          }),
        );
        try {
          harness.setResponses([
            fauxAssistantMessage("", { errorMessage, stopReason: "error" }),
            fauxAssistantMessage("recovered"),
          ]);

          yield* Effect.promise(() => harness.session.prompt("test"));

          expect(harness.faux.state.callCount).toBe(2);
          expect(
            harness.eventsOfType("auto_retry_start").map((event) => event.errorMessage),
          ).toEqual([errorMessage]);
          expect(harness.eventsOfType("auto_retry_end").map((event) => event.success)).toEqual([
            true,
          ]);
        } finally {
          harness.cleanup();
        }
      }),
    ),
  );
});
