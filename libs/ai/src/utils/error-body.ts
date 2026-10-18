// Shared normalization for provider HTTP error objects.
//
// Endpoints behind a proxy / gateway may return a non-2xx response whose body
// the provider SDK cannot fold into `error.message`. The SDK error object still
// carries the HTTP status and the raw/parsed body, but under SDK-specific field
// names. Provider catch blocks that read only `error.message` therefore drop
// the body and surface opaque messages like `"403 status code (no body)"` or
// collapse to `"Unknown: UnknownError"`.
//
// `normalizeProviderError` probes the known SDK field shapes (`openai`,
// `@google/genai`, msa's own HTTP errors) and returns a struct each provider
// composes into its display string. The `messageCarriesBody` flag captures the
// Anthropic / `@google/genai` happy path where the SDK already folded the body
// into the message, so providers can preserve it without double-printing.

export const MAX_PROVIDER_ERROR_BODY_CHARS = 4000;

export interface NormalizedProviderError {
  /** HTTP status code, when one could be extracted from the SDK error object. */
  status?: number | undefined;
  /** Raw HTTP body reason, already trimmed and truncated to the cap. */
  body?: string | undefined;
  /** `error.message`, or `safeJsonStringify(error)` for a non-`Error` throw. */
  message: string;
  /** True when `message` already contains the body (no separate body to add). */
  messageCarriesBody: boolean;
}

type SdkErrorShape = Error & {
  status?: unknown;
  body?: unknown;
  error?: unknown;
};

export function normalizeProviderError(error: unknown): NormalizedProviderError {
  if (!(error instanceof Error)) {
    return { message: safeJsonStringify(error), messageCarriesBody: false };
  }

  const sdkError = error as SdkErrorShape;
  const status = extractStatus(sdkError);
  const body = extractBody(sdkError);
  const messageCarriesBody = body === undefined || error.message.includes(body);

  return {
    status,
    body,
    message: error.message,
    messageCarriesBody,
  } satisfies NormalizedProviderError;
}

/**
 * Probe the HTTP status from `status` (`openai`, `@google/genai`).
 *
 * @param {SdkErrorShape} error - thrown value
 * @returns {number | undefined} the HTTP status, or undefined
 */
function extractStatus(error: SdkErrorShape): number | undefined {
  if (typeof error.status === "number") return error.status;
  return undefined;
}

/**
 * Probe the raw body reason, first usable hit wins, in SDK-field order:
 * `body` string (msa's own HTTP errors) → `error` parsed JSON body object (`openai` SDK's
 * `this.error`). Empty objects are treated as no body so they do not surface
 * as `"{}"`. The chosen body is truncated to the cap.
 *
 * @param {SdkErrorShape} error - thrown value
 * @returns {string | undefined} the truncated body, or undefined
 */
function extractBody(error: SdkErrorShape): string | undefined {
  const bodyText = pickBodyText(error);
  if (bodyText === undefined) return undefined;
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) return undefined;
  return truncateErrorText(trimmed, MAX_PROVIDER_ERROR_BODY_CHARS);
}

function pickBodyText(error: SdkErrorShape): string | undefined {
  if (typeof error.body === "string") return error.body;
  if (isPlainNonEmptyObject(error.error)) return safeJsonStringify(error.error);
  return undefined;
}

/**
 * Only a PLAIN object counts as an HTTP body. SDK error fields can hold class
 * instances instead of parsed bodies, and stringifying one produces garbage
 * like `{"_events":...}` that would REPLACE `error.message` in the composed
 * display string. A class instance yields no body, `messageCarriesBody` stays
 * true, and the real message survives, while parsed JSON bodies (plain
 * objects by construction) still pass.
 *
 * @param {unknown} value - candidate body
 * @returns {boolean} whether the value is a plain object with keys
 */
function isPlainNonEmptyObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.keys(value).length > 0;
}

/**
 * Compose a display string from a normalized error. When the message already
 * carries the body (Anthropic / `@google/genai` happy path) or no body/status
 * was extracted, the message is returned unchanged. Otherwise the status and
 * body are surfaced, with an optional provider prefix.
 *
 * - no prefix: `"<status>: <body>"`
 * - prefix:    `"<prefix> (<status>): <body>"`
 *
 * @param {NormalizedProviderError} norm - normalized error
 * @param {string} [prefix] - provider label
 * @returns {string} the display string
 */
export function formatProviderError(norm: NormalizedProviderError, prefix?: string): string {
  if (norm.messageCarriesBody || norm.status === undefined || norm.body === undefined) {
    return prefix !== undefined && norm.status !== undefined
      ? `${prefix} (${norm.status}): ${norm.message}`
      : norm.message;
  }
  return prefix === undefined
    ? `${norm.status}: ${norm.body}`
    : `${prefix} (${norm.status}): ${norm.body}`;
}

export function truncateErrorText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}

export function safeJsonStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}
