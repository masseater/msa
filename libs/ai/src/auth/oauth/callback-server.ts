import { Cause, Deferred, Effect, Exit, Fiber } from "effect";

import {
  type LocalHttpRequest,
  type LocalHttpResponse,
  startLocalHttpServer,
} from "../../utils/local-http-server.ts";
import { oauthErrorHtml, oauthSuccessHtml } from "../../utils/oauth-page.ts";
import type { ProviderAuthInteraction } from "../types.ts";

export interface OAuthCallbackServerOptions<T> {
  readonly providerName: string;
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly redirectHost?: string;
  readonly state?: string | undefined;
  readonly complete: (code: string) => Effect.Effect<T>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface OAuthCallbackServer<T> {
  readonly redirectUri: string;
  readonly wait: Effect.Effect<T | undefined>;
  readonly cancel: Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

const page = (status: number, body: string): LocalHttpResponse => ({
  status,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  body,
});

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const redirectUriOf = <T>(options: OAuthCallbackServerOptions<T>, port: number): string => {
  const redirectHost = options.redirectHost ?? options.host;
  const authority = redirectHost.includes(":") ? `[${redirectHost}]` : redirectHost;
  return `http://${authority}:${port}${options.path}`;
};

type Reply = (response: LocalHttpResponse) => Effect.Effect<void>;

interface CallbackFlow<T> {
  readonly options: OAuthCallbackServerOptions<T>;
  readonly state: { claimed: boolean; settled: boolean };
  readonly finish: (exit: Exit.Exit<T | undefined>) => Effect.Effect<void>;
}

const claim = <T>(flow: CallbackFlow<T>, code: string, reply: Reply): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { providerName } = flow.options;
    flow.state.claimed = true;
    const exit = yield* Effect.exit(flow.options.complete(code));
    if (Exit.isSuccess(exit)) {
      yield* reply(
        page(200, oauthSuccessHtml(`Signed in to ${providerName}. You may now close this page.`)),
      );
      return yield* flow.finish(exit);
    }
    const failure = toError(Cause.squash(exit.cause));
    yield* reply(page(502, oauthErrorHtml(`${providerName} sign-in failed.`, failure.message)));
    return yield* flow.finish(Exit.die(failure));
  });

const handleCallback = <T>(
  flow: CallbackFlow<T>,
  { method, url }: LocalHttpRequest,
  reply: Reply,
): Effect.Effect<void> => {
  const { options, state } = flow;
  if (method !== "GET" || url.pathname !== options.path) {
    return reply(page(404, oauthErrorHtml("Callback route not found.", undefined)));
  }
  if (options.state !== undefined && url.searchParams.get("state") !== options.state) {
    return reply(page(400, oauthErrorHtml("State mismatch.", undefined)));
  }
  if (state.claimed || state.settled) {
    return reply(page(409, oauthErrorHtml("This sign-in has already been handled.", undefined)));
  }
  const error = url.searchParams.get("error");
  if (error !== null && error !== "") {
    const description = url.searchParams.get("error_description") ?? error;
    const failure = new Error(`${options.providerName} authorization failed: ${description}`);
    return Effect.andThen(
      reply(
        page(400, oauthErrorHtml(`${options.providerName} authorization failed.`, description)),
      ),
      flow.finish(Exit.die(failure)),
    );
  }
  const code = url.searchParams.get("code");
  if (code === null || code === "") {
    return reply(page(400, oauthErrorHtml("Missing authorization code.", undefined)));
  }
  return claim(flow, code, reply);
};

const makeFlow = <T>(options: OAuthCallbackServerOptions<T>) =>
  Effect.gen(function* () {
    const result = yield* Deferred.make<T | undefined>();
    const runFork = Effect.runForkWith(yield* Effect.context<never>());
    const state = { claimed: false, settled: false };
    const onAbort = (): void => {
      Exit.die(new Error("Login cancelled")).pipe(finish, runFork);
    };
    const finish = (exit: Exit.Exit<T | undefined>): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (state.settled) return Effect.void;
        state.settled = true;
        options.signal?.removeEventListener("abort", onAbort);
        return Effect.asVoid(Deferred.done(result, exit));
      });
    const flow: CallbackFlow<T> = { options, state, finish };
    return { flow, result, onAbort };
  });

const startTimeout = <T>(
  flow: CallbackFlow<T>,
  result: Deferred.Deferred<T | undefined>,
): Effect.Effect<void> => {
  const { timeoutMs, providerName } = flow.options;
  if (timeoutMs === undefined) return Effect.void;
  const timedOut = Effect.andThen(
    Effect.sleep(timeoutMs),
    flow.finish(Exit.die(new Error(`${providerName} sign-in timed out`))),
  );
  return Effect.asVoid(
    Effect.forkDetach(
      Effect.raceFirst(Effect.asVoid(Effect.exit(Deferred.await(result))), timedOut),
    ),
  );
};

export const startOAuthCallbackServer = <T>(
  options: OAuthCallbackServerOptions<T>,
): Effect.Effect<OAuthCallbackServer<T>> =>
  Effect.gen(function* () {
    if (options.signal?.aborted === true) return yield* Effect.die(new Error("Login cancelled"));
    const { flow, result, onAbort } = yield* makeFlow(options);
    const server = yield* startLocalHttpServer({
      host: options.host,
      port: options.port,
      baseUrl: "http://localhost",
      handle: (request, reply) => handleCallback(flow, request, reply),
      onError: (error) => flow.finish(Exit.die(error)),
      closeConnections: false,
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    yield* startTimeout(flow, result);
    return {
      redirectUri: redirectUriOf(options, server.port),
      wait: Deferred.await(result),
      cancel: Effect.suspend(() =>
        flow.state.claimed ? Effect.void : flow.finish(Exit.succeed(undefined)),
      ),
      close: Effect.andThen(
        flow.finish(Exit.die(new Error("OAuth callback server closed"))),
        server.close,
      ),
    };
  });

export interface CallbackOrManualInputOptions<T> {
  readonly interaction: ProviderAuthInteraction;
  readonly callback: OAuthCallbackServer<T> | undefined;
  readonly message: string;
  readonly placeholder: string;
}

export type CallbackOrManualInput<T> =
  | { readonly type: "callback"; readonly value: T }
  | { readonly type: "manual"; readonly input: string };

const promptManualInput = <T>(
  { interaction, callback, message, placeholder }: CallbackOrManualInputOptions<T>,
  failure: { cause: Cause.Cause<never> | undefined },
  signal: AbortSignal,
): Effect.Effect<string | undefined> => {
  const cancelCallback = callback === undefined ? Effect.void : callback.cancel;
  return Effect.promise(() =>
    interaction.prompt({ type: "manual_code", message, placeholder, signal }),
  ).pipe(
    Effect.matchCauseEffect({
      onSuccess: (input) => Effect.as(cancelCallback, input),
      onFailure: (cause) =>
        Effect.as(
          Effect.andThen(
            Effect.sync(() => {
              failure.cause = cause;
            }),
            cancelCallback,
          ),
          undefined,
        ),
    }),
  );
};

export const waitForCallbackOrManualInput = <T>(
  options: CallbackOrManualInputOptions<T>,
): Effect.Effect<CallbackOrManualInput<T>> =>
  Effect.gen(function* () {
    const failure: { cause: Cause.Cause<never> | undefined } = { cause: undefined };
    const signal = yield* Effect.abortSignal;
    const manual = yield* Effect.forkChild(promptManualInput(options, failure, signal));
    const rethrow = Effect.suspend(() =>
      failure.cause === undefined ? Effect.void : Effect.die(Cause.squash(failure.cause)),
    );
    return yield* Effect.gen(function* () {
      const { callback } = options;
      const value = callback === undefined ? undefined : yield* callback.wait;
      yield* rethrow;
      if (value !== undefined) return { type: "callback" as const, value };
      const input = yield* Fiber.join(manual);
      yield* rethrow;
      return { type: "manual" as const, input: input ?? "" };
    }).pipe(Effect.ensuring(Fiber.interrupt(manual)));
  }).pipe(Effect.scoped);
