import type typesModule from "../types.types.ts";
import type providerFailureTypes from "./provider-failure.types.ts";

function buildProviderErrorPattern(patterns: readonly string[]): RegExp {
  return new RegExp(patterns.join("|"), "iu");
}

const NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN = buildProviderErrorPattern([
  "GoUsageLimitError",
  "FreeUsageLimitError",

  "Monthly usage limit reached",
  "available balance",

  "insufficient_quota",
  "out of budget",
  "quota exceeded",
  "billing",

  "subscription_sharing_usage_limit_exceeded",
]);

const PAYMENT_REQUIRED_STATUS = 402;

const PROVIDER_ACCOUNT_STATUSES: ReadonlySet<number> = new Set([401, PAYMENT_REQUIRED_STATUS, 403]);

const RETRYABLE_PROVIDER_STATUSES: ReadonlySet<number> = new Set([
  429, 500, 502, 503, 504, 520, 524,
]);

const HTTP_REASON_PHRASES = [
  "Bad Request",
  "Unauthorized",
  "Payment Required",
  "Forbidden",
  "Not Found",
  "Method Not Allowed",
  "Request Timeout",
  "Conflict",
  "Payload Too Large",
  "Content Too Large",
  "Unprocessable (?:Entity|Content)",
  "Too Many Requests",
  "Internal Server Error",
  "Not Implemented",
  "Bad Gateway",
  "Service Unavailable",
  "Gateway Time-?out",
  "Web Server Returned an Unknown Error",
  "Unknown Error",
  "A Timeout Occurred",
];

const STATUS_PREFIX = String.raw`(?:^\s*|\b(?:HTTP(?:\/\d(?:\.\d)?)?|status(?:\s+code)?|error(?:\s+code)?|failed|returned|answered)\s*[:=]?\s*\(?)`;

const STATUS_END = String.raw`(?=\s*(?:$|[:)"]|status\s+code\b|(?:${HTTP_REASON_PHRASES.join("|")})\b))`;

const HTTP_STATUS_IN_TEXT = new RegExp(`${STATUS_PREFIX}([1-5]\\d{2})${STATUS_END}`, "iu");

const HTTP_STATUS_FIELD_IN_TEXT =
  /(?:\bstatus(?:\s+code)?\s*[:=]\s*|"(?:code|status)"\s*:\s*)([1-5]\d{2})(?=\s*[,;}])/iu;

const textStatus = (text: string): number | undefined => {
  const status = (HTTP_STATUS_IN_TEXT.exec(text) ?? HTTP_STATUS_FIELD_IN_TEXT.exec(text))?.[1];
  return status === undefined ? undefined : Number(status);
};

const PROVIDER_QUOTA_ERROR_PATTERN = buildProviderErrorPattern([
  "GoUsageLimitError",
  "FreeUsageLimitError",
  "Monthly usage limit reached",
  "\\binsufficient_quota\\b",
  "\\bbilling_error\\b",
  "\\bpayment_required\\b",
  "subscription_sharing_usage_limit_exceeded",
  "requires more credits",
  "credit balance is too low",
]);

const PROVIDER_ERROR_KIND_FIELD = String.raw`"(?:type|code|status)"\s*:\s*"`;

const PROVIDER_AUTH_ERROR_PATTERN = new RegExp(
  `${PROVIDER_ERROR_KIND_FIELD}(?:authentication_error|permission_error|invalid_api_key|PERMISSION_DENIED|UNAUTHENTICATED)"`,
  "u",
);

const RETRYABLE_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
  "overloaded",
  "server_busy",
  "servers are currently busy",
  "currently experiencing high demand",
  "model is at capacity",
  "rate.?limit",
  "too many requests",
  "service.?(?:is.?)?(?:temporarily.?)?unavailable",
  "server.?error",
  "internal.?error",

  "provider.?returned.?(?:an.?)?error",
  "exceeded request buffer limit while retrying upstream",
  "unable to forward upstream",

  "network.?error",
  "connection.?error",
  "connection.?refused",
  "connection.?lost",
  "other side closed",
  "fetch failed",
  "getaddrinfo",
  "ENOTFOUND",
  "EAI_AGAIN",
  "upstream.?connect",
  "reset before headers",
  "socket hang up",
  "socket connection was closed",
  "timed? out",
  "timeout",
  "terminated",

  "websocket.?closed",
  "websocket.?error",

  "ended without",
  "stream ended before message_stop",
  "stream ended before a terminal response event",
  "http2 request did not get a response",
  "pending stream has been canceled",

  "retry delay",

  "you can retry your request",
  "try your request again",
  "please retry your request",

  "ResourceExhausted",

  "subscription_sharing_usage_unavailable",
  "subscription_sharing_user_unavailable",
]);

interface ProviderFailure {
  readonly text: string;
  readonly status: number | undefined;
  readonly resetsAt: number | undefined;
}

const providerFailure = (message: typesModule.AssistantMessage): ProviderFailure | undefined => {
  if (message.stopReason !== "error") return undefined;
  const text = message.errorMessage ?? "";
  const status = message.errorStatus ?? textStatus(text);
  const resetsAt = message.errorResetsAt;
  return text === "" && status === undefined && resetsAt === undefined
    ? undefined
    : { resetsAt, status, text };
};

const unusableReason = ({
  resetsAt,
  status,
  text,
}: ProviderFailure): providerFailureTypes.ProviderUnusableReason | undefined => {
  if (status === PAYMENT_REQUIRED_STATUS) return "quota";
  if (PROVIDER_ACCOUNT_STATUSES.has(status ?? 0)) return "auth";
  if (resetsAt !== undefined) return "quota";
  if (PROVIDER_QUOTA_ERROR_PATTERN.test(text)) return "quota";
  return PROVIDER_AUTH_ERROR_PATTERN.test(text) ? "auth" : undefined;
};

const isNeverRetried = (failure: ProviderFailure): boolean =>
  unusableReason(failure) !== undefined ||
  NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN.test(failure.text);

const providerUnusableReason = (
  message: typesModule.AssistantMessage,
): providerFailureTypes.ProviderUnusableReason | undefined => {
  const failure = providerFailure(message);
  return failure === undefined ? undefined : unusableReason(failure);
};

const isProviderUnusableError = (message: typesModule.AssistantMessage): boolean =>
  providerUnusableReason(message) !== undefined;

const isRetryableAssistantError = (message: typesModule.AssistantMessage): boolean => {
  const failure = providerFailure(message);
  if (failure === undefined || isNeverRetried(failure)) return false;
  return (
    RETRYABLE_PROVIDER_STATUSES.has(failure.status ?? 0) ||
    RETRYABLE_PROVIDER_ERROR_PATTERN.test(failure.text)
  );
};

const providerFailureModule = {
  isProviderUnusableError,
  isRetryableAssistantError,
  providerUnusableReason,
};

export default providerFailureModule;
