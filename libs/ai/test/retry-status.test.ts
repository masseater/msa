import { describe, expect, it } from "vite-plus/test";

import faux from "../src/providers/faux.ts";
import errorBody from "../src/utils/error-body.ts";
import retry from "../src/utils/retry.ts";

const { isProviderUnusableError, isRetryableAssistantError } = retry;
const { formatProviderError, normalizeProviderError } = errorBody;
const { fauxAssistantMessage } = faux;

const failed = (errorMessage: string, errorStatus?: number) => ({
  ...fauxAssistantMessage("", { errorMessage, stopReason: "error" }),
  ...(errorStatus === undefined ? {} : { errorStatus }),
});

const sdkError = (status: number) =>
  Object.assign(new Error("request failed"), { body: '{"error":"x"}', status });

const RETRYABLE_STATUSES = [429, 500, 502, 503, 504, 520, 524];
const ACCOUNT_STATUSES = [401, 402, 403];

describe("the HTTP status recorded on the message", () => {
  it.each(RETRYABLE_STATUSES)("retries %i without reading the text", (status) => {
    const message = failed("upstream hiccup", status);
    expect(isRetryableAssistantError(message)).toBe(true);
    expect(isProviderUnusableError(message)).toBe(false);
  });

  it.each(ACCOUNT_STATUSES)("treats %i as unusable without reading the text", (status) => {
    const message = failed("no access", status);
    expect(isProviderUnusableError(message)).toBe(true);
    expect(isRetryableAssistantError(message)).toBe(false);
  });

  it("is enough when the error text is empty", () => {
    expect(isRetryableAssistantError(failed("", 503))).toBe(true);
    expect(isProviderUnusableError(failed("", 402))).toBe(true);
    expect(isRetryableAssistantError(failed(""))).toBe(false);
  });

  it("wins over a number in the text", () => {
    expect(isRetryableAssistantError(failed("Proxy error: 502 Bad Gateway", 400))).toBe(false);
    expect(isProviderUnusableError(failed("Proxy error: 403 ", 400))).toBe(false);
  });

  it("is what provider failures record", () => {
    const norm = normalizeProviderError(sdkError(402));
    const message: { errorStatus?: number } = {};
    errorBody.recordErrorStatus(message, norm);
    expect(message.errorStatus).toBe(402);
    errorBody.recordErrorStatus(message, normalizeProviderError(new Error("boom")));
    expect(message.errorStatus).toBeUndefined();
  });
});

describe("a retryable status in the error text", () => {
  it.each([
    "Proxy error: 502 Bad Gateway",
    "Proxy error: 524 ",
    "error code: 524",
    "HTTP 429",
    "HTTP/1.1 503 Service Unavailable",
    "request failed: 429",
    "Upstream error 503",
    "429 Too Many Requests",
    "503 status code (no body)",
    "OpenAI API error (502): Bad Gateway",
    '{"error":{"code":503,"message":"The model is unavailable"}}',
    "got status: 503 Service Unavailable. {}",
    "Request failed with status code 500",
    "HTTP request failed. status=520; url=https://example.com; body=",
    "llama.cpp returned 503",
    "OpenRouter model list request failed: 504",
    "Embedding endpoint http://localhost answered 502: busy",
  ])("retries %s", (errorMessage) => {
    expect(isRetryableAssistantError(failed(errorMessage))).toBe(true);
  });

  it.each(
    RETRYABLE_STATUSES.flatMap((status) =>
      [undefined, "OpenAI API error"].map((prefix) => [status, prefix] as const),
    ),
  )("retries what formatProviderError builds for %i (prefix %s)", (status, prefix) => {
    const text = formatProviderError(normalizeProviderError(sdkError(status)), prefix);
    expect(isRetryableAssistantError(failed(text))).toBe(true);
  });
});

describe("an account error in the error text", () => {
  it.each(
    ACCOUNT_STATUSES.flatMap((status) =>
      [undefined, "Anthropic API error"].map((prefix) => [status, prefix] as const),
    ),
  )("treats what formatProviderError builds for %i (prefix %s) as unusable", (status, prefix) => {
    const text = formatProviderError(normalizeProviderError(sdkError(status)), prefix);
    expect(isProviderUnusableError(failed(text))).toBe(true);
  });

  it.each([
    "Proxy error: 403 ",
    '402: {"message":"This request requires more credits, or fewer max_tokens.","code":402}',
    '401: {"type":"server_error","message":"Upstream request failed: Invalid credential"}',
    "403 Forbidden",
    'Anthropic API error (402): {"type":"error","error":{"type":"billing_error"}}',
    '{"error":{"code":402,"message":"Prompt tokens limit exceeded"}}',
    "Request failed with status code 401",
    "Your credit balance is too low to access the API.",
    "Invalid API key provided",
    "insufficient_quota",
  ])("treats %s as unusable and never retries it", (errorMessage) => {
    expect(isProviderUnusableError(failed(errorMessage))).toBe(true);
    expect(isRetryableAssistantError(failed(errorMessage))).toBe(false);
  });
});

describe("a number in the error text that is not its status", () => {
  it.each([
    "overloaded_error",
    "503 Service Unavailable",
    "You requested 1402 tokens; timeout",
    "max_tokens: 402",
    "Request 402 tokens exceed the context window",
    "400 Bad Request: max_tokens 402 too large",
    "400 Bad Request: 401 tool calls exceed the limit",
  ])("keeps %s usable", (errorMessage) => {
    expect(isProviderUnusableError(failed(errorMessage))).toBe(false);
  });

  it.each([
    "400 Bad Request: max_tokens 500 too large",
    "Prompt has 429 images; at most 100",
    "max_tokens: 502",
  ])("does not retry %s", (errorMessage) => {
    expect(isRetryableAssistantError(failed(errorMessage))).toBe(false);
  });
});
