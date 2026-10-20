import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { normalizeContext } from "../src/compat.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import anthropicSseParsingSupport from "./anthropic-sse-parsing-support.ts";
import modelChoice from "./model-choice.ts";

const { createFakeAnthropicClient, createSseResponse, sse } = anthropicSseParsingSupport;
const { chooseModel, usesApi } = modelChoice;

const explanation =
  "This request triggered restrictions on violative cyber content and was blocked under Anthropic's Usage Policy. To learn more, provide feedback, or request an exemption based on how you use Claude, visit our help center: https://support.claude.com/en/articles/14604842-real-time-cyber-safeguards-on-claude.";

const streamBlockedRequest = (events: { data: object; event: string }[]) =>
  Effect.promise(() =>
    streamAnthropic(
      chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages")),
      normalizeContext({
        messages: [{ content: "blocked request", role: "user", timestamp: currentTimeMillis() }],
      }),
      { client: createFakeAnthropicClient(createSseResponse(events)) },
    ).result(),
  );

const preservesRefusalStopDetails = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* streamBlockedRequest([
        sse.messageStart("msg_01XFUDYJgAACzvnptvVoYEL", 412),
        sse.messageDelta(
          {
            stop_details: { category: "cyber", explanation, type: "refusal" },
            stop_reason: "refusal",
          },
          412,
          0,
        ),
        sse.messageStop,
      ]);
      expect(result.stopReason).toBe("error");
      expect(result.rawStopReason).toBe("refusal");
      expect(result.errorMessage).toBe(explanation);
    }),
  );

const describesSensitiveStop = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* streamBlockedRequest([
        sse.messageStart("msg_sensitive"),
        sse.messageDelta({ stop_reason: "sensitive" }, 12, 0),
        sse.messageStop,
      ]);
      expect(result.stopReason).toBe("error");
      expect(result.rawStopReason).toBe("sensitive");
      expect(result.errorMessage).toBe("Provider stopped with: sensitive");
    }),
  );

describe("Anthropic raw SSE parsing", () => {
  it("preserves refusal stop details from message_delta", preservesRefusalStopDetails);
  it("preserves sensitive stop reasons with a descriptive error message", describesSensitiveStop);
});
