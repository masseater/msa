import { Effect } from "effect";
import { dual } from "effect/Function";

import { McpForeignError } from "../foreign.ts";
import { McpHttpError } from "./errors/http-error.ts";

const ERROR_MESSAGE_BODY_CHARS = 500;

export interface StreamCursor {
  lastEventId: string | undefined;
  retryMs: number | undefined;
  received: boolean;
}

export const newCursor = (): StreamCursor => ({
  lastEventId: undefined,
  retryMs: undefined,
  received: false,
});

export function contentType(response: Response): string | undefined {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
}

export function needsAuthorization(response: Response): boolean {
  if (response.status === 401) return true;
  if (response.status !== 403) return false;
  return /(?:^|[\s,])error="?insufficient_scope"?/iu.test(
    response.headers.get("www-authenticate") ?? "",
  );
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export const discard = (response: Response): Effect.Effect<void> =>
  Effect.promise(() => response.body?.cancel().catch(() => undefined) ?? Promise.resolve());

const describe = (status: number, body: string): string => {
  const text = body.trim();
  const snippet =
    text.length > ERROR_MESSAGE_BODY_CHARS
      ? `${text.slice(0, ERROR_MESSAGE_BODY_CHARS - 3)}...`
      : text;
  return `MCP HTTP request failed with status ${status}${snippet === "" ? "" : `: ${snippet}`}`;
};

export const describeHttpFailure: {
  (body: string): (status: number) => string;
  (status: number, body: string): string;
} = dual(2, describe);

export const unwrapCause = (error: unknown): unknown =>
  error instanceof McpForeignError ? error.cause : error;

export function isRetryable(failure: unknown): boolean {
  const error = unwrapCause(failure);
  if (error instanceof McpHttpError) return isTransientStatus(error.status);
  if (error instanceof TypeError) return true;
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && (code.startsWith("E") || code.startsWith("UND_ERR"));
}

const abortedBy = (signal: AbortSignal): Effect.Effect<boolean> =>
  Effect.callback<boolean>((resume) => {
    const onAbort = () => {
      resume(Effect.succeed(false));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });

const sleepFor = (ms: number, signal: AbortSignal): Effect.Effect<boolean> =>
  signal.aborted
    ? Effect.succeed(false)
    : Effect.race(Effect.as(Effect.sleep(ms), true), abortedBy(signal));

export const sleepUnlessAborted: {
  (signal: AbortSignal): (ms: number) => Effect.Effect<boolean>;
  (ms: number, signal: AbortSignal): Effect.Effect<boolean>;
} = dual(2, sleepFor);
