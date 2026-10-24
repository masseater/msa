import { describe, expect, it } from "vite-plus/test";

import faux from "../src/providers/faux.ts";
import retry from "../src/utils/retry.ts";

const { isProviderUnusableError, isRetryableAssistantError } = retry;
const { fauxAssistantMessage } = faux;

describe("provider account errors", () => {
  it.each([
    '402: {"message":"This request requires more credits, or fewer max_tokens.","code":402}',
    '401: {"type":"server_error","message":"Upstream request failed: Invalid credential"}',
    "403 Forbidden",
    "Your credit balance is too low to access the API.",
    "Invalid API key provided",
    "insufficient_quota",
  ])("treats %s as unusable and never retries it", (errorMessage) => {
    const message = fauxAssistantMessage("", { errorMessage, stopReason: "error" });
    expect(isProviderUnusableError(message)).toBe(true);
    expect(isRetryableAssistantError(message)).toBe(false);
  });

  it.each([
    'Anthropic API error (402): {"type":"error","error":{"type":"billing_error"}}',
    '{"error":{"code":402,"message":"Prompt tokens limit exceeded"}}',
    "Request failed with status code 401",
  ])("reads the HTTP status of %s", (errorMessage) => {
    expect(
      isProviderUnusableError(fauxAssistantMessage("", { errorMessage, stopReason: "error" })),
    ).toBe(true);
  });

  it.each([
    "overloaded_error",
    "503 Service Unavailable",
    "You requested 1402 tokens; timeout",
    "max_tokens: 402",
    "Request 402 tokens exceed the context window",
    "400 Bad Request: max_tokens 402 too large",
    "400 Bad Request: 401 tool calls exceed the limit",
  ])("keeps %s usable", (errorMessage) => {
    expect(
      isProviderUnusableError(fauxAssistantMessage("", { errorMessage, stopReason: "error" })),
    ).toBe(false);
  });
});

describe("provider status retries", () => {
  it.each([
    "429 Too Many Requests",
    "OpenAI API error (502): Bad Gateway",
    '{"error":{"code":503,"message":"The model is unavailable"}}',
  ])("retries %s by its HTTP status", (errorMessage) => {
    expect(
      isRetryableAssistantError(fauxAssistantMessage("", { errorMessage, stopReason: "error" })),
    ).toBe(true);
  });

  it.each(["400 Bad Request: max_tokens 500 too large", "Prompt has 429 images; at most 100"])(
    "does not retry %s",
    (errorMessage) => {
      expect(
        isRetryableAssistantError(fauxAssistantMessage("", { errorMessage, stopReason: "error" })),
      ).toBe(false);
    },
  );
});
