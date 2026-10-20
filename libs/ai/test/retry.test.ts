import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import faux from "../src/providers/faux.ts";
import retry from "../src/utils/retry.ts";
import type retryTypes from "../src/utils/retry.types.ts";

const { isRetryableAssistantError, retryAssistantCall, retryDelayMs } = retry;
const { fauxAssistantMessage } = faux;

const openAIExplicitRetryMessage =
  "An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID req_******** in your message.";

const bedrockExplicitRetryMessage =
  '{"message":"The system encountered an unexpected error during processing. Try your request again."}';

const nvidiaNIMResourceExhaustedMessage =
  "ResourceExhausted: Worker local total request limit reached (288/48)";

const bunFetchSocketClosedMessage =
  "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()";

const openAIResponsesEarlyEofMessage =
  "OpenAI Responses stream ended before a terminal response event";

const wrappedDnsLookupError =
  "The pending stream has been canceled (caused by: getaddrinfo ENOTFOUND bedrock-runtime.us-east-1.amazonaws.com)";

const azurePeakLoadError =
  "The system is currently experiencing high demand and cannot process your request. Your request exceeds the maximum usage size allowed during peak load. For improved capacity reliability, consider switching to Provisioned Throughput.";

describe("provider retry classification", () => {
  it("matches explicit provider retry guidance", () => {
    expect(
      isRetryableAssistantError(
        fauxAssistantMessage("", { errorMessage: openAIExplicitRetryMessage, stopReason: "error" }),
      ),
    ).toBe(true);
    expect(
      isRetryableAssistantError(
        fauxAssistantMessage("", {
          errorMessage: bedrockExplicitRetryMessage,
          stopReason: "error",
        }),
      ),
    ).toBe(true);
    expect(
      isRetryableAssistantError(
        fauxAssistantMessage("", {
          errorMessage: nvidiaNIMResourceExhaustedMessage,
          stopReason: "error",
        }),
      ),
    ).toBe(true);
  });

  it("matches Bun fetch socket drop wording", () => {
    expect(
      isRetryableAssistantError(
        fauxAssistantMessage("", {
          errorMessage: bunFetchSocketClosedMessage,
          stopReason: "error",
        }),
      ),
    ).toBe(true);
  });

  it("matches upstream request buffer exhaustion wording", () => {
    expect(
      isRetryableAssistantError(
        fauxAssistantMessage("", {
          errorMessage: "Error: exceeded request buffer limit while retrying upstream",
          stopReason: "error",
        }),
      ),
    ).toBe(true);
  });
});

describe("provider retry classification", () => {
  it.each([
    wrappedDnsLookupError,
    "connect ENOTFOUND api.example.com",
    "EAI_AGAIN api.example.com",
    "getaddrinfo failed for api.example.com",
  ])("matches DNS transport failure wording: %s", (errorMessage) => {
    expect(
      isRetryableAssistantError(fauxAssistantMessage("", { errorMessage, stopReason: "error" })),
    ).toBe(true);
  });

  it.each([
    "The pending stream has been canceled",
    "The pending stream has been canceled (caused by: socket closed)",
  ])("matches HTTP/2 pending stream cancellation: %s", (errorMessage) => {
    expect(
      isRetryableAssistantError(fauxAssistantMessage("", { errorMessage, stopReason: "error" })),
    ).toBe(true);
  });

  it.each(["The service is temporarily unavailable. Please retry later."])(
    "matches service unavailable wording: %s",
    (errorMessage) => {
      expect(
        isRetryableAssistantError(fauxAssistantMessage("", { errorMessage, stopReason: "error" })),
      ).toBe(true);
    },
  );

  it("matches OpenAI Responses streams that end before terminal events", () => {
    expect(
      isRetryableAssistantError(
        fauxAssistantMessage("", {
          errorMessage: openAIResponsesEarlyEofMessage,
          stopReason: "error",
        }),
      ),
    ).toBe(true);
  });

  it("matches Azure peak-load capacity errors", () => {
    expect(
      isRetryableAssistantError(
        fauxAssistantMessage("", { errorMessage: azurePeakLoadError, stopReason: "error" }),
      ),
    ).toBe(true);
  });
});

describe("provider retry classification", () => {
  it("keeps provider limit errors non-retryable", () => {
    expect(
      isRetryableAssistantError(
        fauxAssistantMessage("", { errorMessage: "429 quota exceeded", stopReason: "error" }),
      ),
    ).toBe(false);
  });

  it("keeps the ChatGPT subscription usage limit non-retryable", () => {
    const errorMessage =
      'OpenAI API error (429): {"code":"subscription_sharing_usage_limit_exceeded","message":"Usage limit reached."}';
    expect(
      isRetryableAssistantError(fauxAssistantMessage("", { errorMessage, stopReason: "error" })),
    ).toBe(false);
  });

  it.each([
    "subscription_sharing_usage_unavailable: Usage cannot be checked.",
    "subscription_sharing_user_unavailable: User cannot be loaded.",
  ])("retries temporary ChatGPT subscription errors: %s", (errorMessage) => {
    expect(
      isRetryableAssistantError(fauxAssistantMessage("", { errorMessage, stopReason: "error" })),
    ).toBe(true);
  });
});

describe("provider retry classification", () => {
  it("classifies assistant error messages", () => {
    expect(
      isRetryableAssistantError(
        fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
      ),
    ).toBe(true);
    expect(
      isRetryableAssistantError(
        fauxAssistantMessage("", {
          errorMessage: "520 status code (no body)",
          stopReason: "error",
        }),
      ),
    ).toBe(true);
    expect(
      isRetryableAssistantError(
        fauxAssistantMessage("", {
          errorMessage: "524 status code (no body)",
          stopReason: "error",
        }),
      ),
    ).toBe(true);
    expect(isRetryableAssistantError(fauxAssistantMessage("not an error"))).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("caps agent retry delay", () => {
    expect(retryDelayMs({ baseDelayMs: 2000 }, 6)).toBe(60000);
    expect(retryDelayMs({ baseDelayMs: 2000, maxAgentDelayMs: 5000 }, 5)).toBe(5000);
    expect(retryDelayMs({ baseDelayMs: 2000, maxAgentDelayMs: 0 }, 5)).toBe(0);
  });
});

describe("retryAssistantCall", () => {
  const enabled: retryTypes.RetryPolicy = { baseDelayMs: 0, enabled: true, maxRetries: 3 };
  it("returns a successful response immediately without retrying", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const produce = vi.fn(() => Promise.resolve(fauxAssistantMessage("ok")));
        const res = yield* Effect.promise(() => retryAssistantCall(produce, enabled, undefined));
        expect(res.content).toEqual([{ text: "ok", type: "text" }]);
        expect(produce).toHaveBeenCalledTimes(1);
      }),
    ));

  it("does not retry an aborted message", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const produce = vi.fn(() =>
          Promise.resolve(fauxAssistantMessage("", { stopReason: "aborted" })),
        );
        const onRetryScheduled = vi.fn();
        const res = yield* Effect.promise(() =>
          retryAssistantCall(produce, enabled, undefined, { onRetryScheduled }),
        );
        expect(res.stopReason).toBe("aborted");
        expect(produce).toHaveBeenCalledTimes(1);
        expect(onRetryScheduled).not.toHaveBeenCalled();
      }),
    ));
});

describe("retryAssistantCall", () => {
  const enabled: retryTypes.RetryPolicy = { baseDelayMs: 0, enabled: true, maxRetries: 3 };
  it("does not retry a non-retryable error (quota/billing)", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const produce = vi.fn(() =>
          Promise.resolve(
            fauxAssistantMessage("", { errorMessage: "insufficient_quota", stopReason: "error" }),
          ),
        );
        const onRetryScheduled = vi.fn();
        const onRetryFinished = vi.fn();
        const res = yield* Effect.promise(() =>
          retryAssistantCall(produce, enabled, undefined, {
            onRetryFinished,
            onRetryScheduled,
          }),
        );
        expect(res.stopReason).toBe("error");
        expect(produce).toHaveBeenCalledTimes(1);
        expect(onRetryScheduled).not.toHaveBeenCalled();
        expect(onRetryFinished).not.toHaveBeenCalled();
      }),
    ));
});
