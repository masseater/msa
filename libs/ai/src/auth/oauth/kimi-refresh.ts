import { Effect } from "effect";

import { sleepUnlessAborted } from "../../utils/abort.ts";
import { type HttpReply, httpRequest } from "../../utils/http.ts";
import { encodeJson } from "../../utils/json-codec.ts";
import { CLIENT_ID, parseTokenResponse, type TokenResponse, tokenUrl } from "./kimi-shared.ts";
import { formHeaders, readJson, requestSignal } from "./response-json.ts";

const REFRESH_MAX_RETRIES = 3;

export interface RefreshRequest {
  readonly oauthHost: string;
  readonly refresh: string;
  readonly signal: AbortSignal;
}

const aborted = (): Error => new Error("Kimi Code token refresh aborted");

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

const requestRefresh = (request: RefreshRequest): Effect.Effect<HttpReply | Error> =>
  httpRequest({
    url: tokenUrl(request.oauthHost),
    method: "POST",
    headers: formHeaders,
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: request.refresh,
    }).toString(),
    signal: requestSignal(request.signal),
  }).pipe(
    Effect.map((reply): HttpReply | Error => reply),
    Effect.catchDefect((error) =>
      Effect.succeed(error instanceof Error ? error : new Error(String(error))),
    ),
  );

const failRefresh = (
  reply: HttpReply,
  json: Record<string, unknown> | null,
): Effect.Effect<never> =>
  Effect.gen(function* () {
    if (reply.status === 401 || reply.status === 403 || json?.["error"] === "invalid_grant") {
      const errorDescription = json?.["error_description"];
      const description = typeof errorDescription === "string" ? `: ${errorDescription}` : "";
      return yield* Effect.die(
        new Error(`Kimi Code token refresh unauthorized (status ${reply.status})${description}`),
      );
    }
    const text = yield* encodeJson(json);
    return yield* Effect.die(
      new Error(
        `Kimi Code token refresh failed with status ${reply.status}${text === "" ? "" : `: ${text}`}`,
      ),
    );
  });

const refreshAttempt = (
  request: RefreshRequest,
  attempt: number,
  lastError: Error | undefined,
): Effect.Effect<TokenResponse> =>
  Effect.gen(function* () {
    if (attempt > REFRESH_MAX_RETRIES) {
      return yield* Effect.die(lastError ?? new Error("Kimi Code token refresh failed"));
    }
    if (attempt > 0) {
      yield* sleepUnlessAborted(1000 * 2 ** (attempt - 1), request.signal, aborted);
    }
    if (request.signal.aborted) return yield* Effect.die(aborted());

    const replyOrError = yield* requestRefresh(request);
    if (replyOrError instanceof Error) {
      return yield* refreshAttempt(request, attempt + 1, replyOrError);
    }

    const json = yield* readJson(replyOrError);
    if (replyOrError.ok) return yield* parseTokenResponse({ json, operation: "refresh" });

    const retryable =
      isRetryableStatus(replyOrError.status) &&
      replyOrError.status !== 401 &&
      replyOrError.status !== 403 &&
      json?.["error"] !== "invalid_grant" &&
      attempt < REFRESH_MAX_RETRIES;
    if (retryable) {
      return yield* refreshAttempt(
        request,
        attempt + 1,
        new Error(`Kimi Code token refresh failed with status ${replyOrError.status}`),
      );
    }
    return yield* failRefresh(replyOrError, json);
  });

export const refreshKimiToken = (request: RefreshRequest): Effect.Effect<TokenResponse> =>
  refreshAttempt(request, 0, undefined);
