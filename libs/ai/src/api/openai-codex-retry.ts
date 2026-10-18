import { Data, Effect } from "effect";

import type { StreamOptions } from "../types.ts";
import { sleepUnlessAborted } from "../utils/abort.ts";
import { currentTimeMillis } from "../utils/clock.ts";
import { requestAbortedError } from "./openai-codex-error.ts";

const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;
export const BASE_DELAY_MS = 1000;

const TERMINAL_RATE_LIMIT =
  /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/iu;
const RETRYABLE_TEXT =
  /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused/iu;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface FailedAttempt {
  readonly status: number;
  readonly errorText: string;
}

export function isRetryableError({ status, errorText }: FailedAttempt): boolean {
  if (status === 429 && TERMINAL_RATE_LIMIT.test(errorText)) return false;
  return RETRYABLE_STATUSES.has(status) || RETRYABLE_TEXT.test(errorText);
}

function retryAfterMillis(headers: Headers): number | undefined {
  const retryAfterMs = headers.get("retry-after-ms");
  const millis = retryAfterMs === null ? Number.NaN : Number(retryAfterMs);
  return Number.isFinite(millis) ? Math.max(0, millis) : undefined;
}

export function getRetryAfterDelayMs(headers: Headers): number | undefined {
  const millis = retryAfterMillis(headers);
  if (millis !== undefined) return millis;
  const retryAfter = headers.get("retry-after");
  if (retryAfter === null || retryAfter === "") return undefined;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? undefined : Math.max(0, date - currentTimeMillis());
}

export class RetryDelayExceededError extends Data.TaggedError("RetryDelayExceededError")<{
  readonly message: string;
}> {}

export function validateRetryDelayMs(
  options: StreamOptions | undefined,
): (delayMs: number) => number {
  return (delayMs) => {
    const maxRetryDelayMs = options?.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    if (maxRetryDelayMs > 0 && delayMs > maxRetryDelayMs) {
      throw new RetryDelayExceededError({
        message: `Server requested ${Math.ceil(delayMs / 1000)}s retry delay (max: ${Math.ceil(maxRetryDelayMs / 1000)}s)`,
      });
    }
    return delayMs;
  };
}

export const sleepUnless =
  (signal: AbortSignal | undefined) =>
  (ms: number): Effect.Effect<void> =>
    sleepUnlessAborted(ms, signal, requestAbortedError);

interface CodexErrorPayload {
  readonly code?: string;
  readonly type?: string;
  readonly message?: string;
  readonly plan_type?: string;
  readonly resets_at?: number;
}

export interface CodexErrorDescription {
  readonly message: string;
  readonly friendlyMessage?: string | undefined;
}

function parseErrorPayload(raw: string): CodexErrorPayload | undefined {
  try {
    return (JSON.parse(raw) as { error?: CodexErrorPayload } | null)?.error;
  } catch {
    return undefined;
  }
}

function usageLimitMessage(err: CodexErrorPayload): string {
  const plan =
    err.plan_type !== undefined && err.plan_type !== ""
      ? ` (${err.plan_type.toLowerCase()} plan)`
      : "";
  const resetsAt = err.resets_at;
  const mins =
    resetsAt !== undefined && resetsAt !== 0 && !Number.isNaN(resetsAt)
      ? Math.max(0, Math.round((resetsAt * 1000 - currentTimeMillis()) / 60000))
      : undefined;
  const when = mins === undefined ? "" : ` Try again in ~${mins} min.`;
  return `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
}

export function describeCodexErrorBody(response: Response): (raw: string) => CodexErrorDescription {
  return (raw) => {
    const fallback = raw || response.statusText || "Request failed";
    const err = parseErrorPayload(raw);
    if (err === undefined) return { message: fallback };
    const code = err.code || err.type || "";
    const limited =
      /usage_limit_reached|usage_not_included|rate_limit_exceeded/iu.test(code) ||
      response.status === 429;
    const friendlyMessage = limited ? usageLimitMessage(err) : undefined;
    return { message: err.message || friendlyMessage || fallback, friendlyMessage };
  };
}
