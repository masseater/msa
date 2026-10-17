import { Clock, Data, Effect } from "effect";

import { type HttpReply, httpRequest } from "../../utils/http.ts";
import { decodeJson } from "../../utils/json-codec.ts";
import type { OAuthCredential } from "../types.ts";

const TOKEN_EXPIRY_SKEW_MS = 60_000;

const errorDetail = (
  status: number,
  oauthError: string | undefined,
  description: string | undefined,
): string =>
  oauthError !== undefined && oauthError !== ""
    ? description !== undefined && description !== ""
      ? `${oauthError}: ${description}`
      : oauthError
    : description !== undefined && description !== ""
      ? description
      : String(status);

export class OAuthResponseError extends Data.TaggedError("RadiusOAuthResponseError")<{
  readonly status: number;
  readonly oauthError: string | undefined;
  readonly message: string;
}> {
  static make(
    status: number,
    oauthError: string | undefined,
    description: string | undefined,
    message: string,
  ): OAuthResponseError {
    return new OAuthResponseError({
      status,
      oauthError,
      message: `${message}: ${errorDetail(status, oauthError, description)}`,
    });
  }
}

export interface OAuthErrorRead {
  readonly reply: HttpReply;
  readonly message: string;
}

export const readOAuthResponseError = ({
  reply,
  message,
}: OAuthErrorRead): Effect.Effect<OAuthResponseError> =>
  Effect.gen(function* () {
    const text = yield* reply.text.pipe(Effect.catchDefect(() => Effect.succeed("")));
    if (text === "") return OAuthResponseError.make(reply.status, undefined, undefined, message);
    const parsed = yield* decodeJson(text).pipe(Effect.catchCause(() => Effect.void));
    if (parsed === undefined || typeof parsed !== "object" || parsed === null) {
      return OAuthResponseError.make(reply.status, undefined, text, message);
    }
    const data = parsed as { error?: unknown; error_description?: unknown };
    return OAuthResponseError.make(
      reply.status,
      typeof data.error === "string" ? data.error : undefined,
      typeof data.error_description === "string" ? data.error_description : undefined,
      message,
    );
  });

export interface TokenRequest {
  readonly gateway: string;
  readonly body: URLSearchParams;
  readonly signal: AbortSignal;
}

export const requestOAuthToken = ({
  gateway,
  body,
  signal,
}: TokenRequest): Effect.Effect<OAuthCredential, OAuthResponseError> =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      url: new URL("/v1/oauth/token", gateway),
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal,
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.die(
          signal.aborted ? new Error("Login cancelled", { cause: error }) : (error as Error),
        ),
      ),
    );

    if (!reply.ok)
      return yield* yield* readOAuthResponseError({
        reply,
        message: "Radius OAuth token request failed",
      });

    const data = (yield* reply.json) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope?: string;
    };
    const now = yield* Clock.currentTimeMillis;

    return {
      type: "oauth" as const,
      access: data.access_token,
      refresh: data.refresh_token,
      expires: now + data.expires_in * 1000 - TOKEN_EXPIRY_SKEW_MS,
      scope: data.scope,
    };
  });
