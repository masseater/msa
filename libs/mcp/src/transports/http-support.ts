import sleep from "@msa/chord/sleep";
import { Effect } from "effect";
import { dual } from "effect/Function";

import foreignModule from "../foreign.ts";
import McpHttpError from "./errors/http-error.ts";
import type httpSupportTypes from "./http-support.types.ts";

const { McpForeignError } = foreignModule;
const { unrefSleep } = sleep;

const ERROR_MESSAGE_BODY_CHARS = 500;

const newCursor = (): httpSupportTypes.StreamCursor => ({
  lastEventId: undefined,
  received: false,
  retryMs: undefined,
});

function contentType(response: Response): string | undefined {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
}

function needsAuthorization(response: Response): boolean {
  if (response.status === 401) return true;
  if (response.status !== 403) return false;
  return /(?:^|[\s,])error="?insufficient_scope"?/iu.test(
    response.headers.get("www-authenticate") ?? "",
  );
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const discard = (response: Response): Effect.Effect<void> =>
  Effect.promise(() => response.body?.cancel().catch(() => undefined) ?? Promise.resolve());

const describe = (status: number, body: string): string => {
  const text = body.trim();
  const snippet =
    text.length > ERROR_MESSAGE_BODY_CHARS
      ? `${text.slice(0, ERROR_MESSAGE_BODY_CHARS - 3)}...`
      : text;
  return `MCP HTTP request failed with status ${status}${snippet === "" ? "" : `: ${snippet}`}`;
};

const describeHttpFailure: {
  (body: string): (status: number) => string;
  (status: number, body: string): string;
} = dual(2, describe);

const unwrapCause = (error: unknown): unknown =>
  error instanceof McpForeignError ? error.cause : error;

function isRetryable(failure: unknown): boolean {
  const error = unwrapCause(failure);
  if (error instanceof McpHttpError) return isTransientStatus(error.status);
  if (error instanceof TypeError) return true;
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && (code.startsWith("E") || code.startsWith("UND_ERR"));
}

const abortedBy = (signal: AbortSignal): Effect.Effect<boolean> =>
  Effect.callback<boolean>((resume) => {
    if (signal.aborted) {
      resume(Effect.succeed(false));
      return undefined;
    }
    const onAbort = () => {
      resume(Effect.succeed(false));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });

const sleepFor = (ms: number, signal: AbortSignal): Effect.Effect<boolean> =>
  Effect.race(Effect.as(unrefSleep(ms), true), abortedBy(signal));

const sleepUnlessAborted: {
  (signal: AbortSignal): (ms: number) => Effect.Effect<boolean>;
  (ms: number, signal: AbortSignal): Effect.Effect<boolean>;
} = dual(2, sleepFor);

const httpSupport = {
  contentType,
  describeHttpFailure,
  discard,
  isRetryable,
  needsAuthorization,
  newCursor,
  sleepUnlessAborted,
  unwrapCause,
};

export default httpSupport;
