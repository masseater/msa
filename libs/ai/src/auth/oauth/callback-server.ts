import { Cause, Deferred, Effect, Exit, Fiber } from "effect";

import localHttpServer from "../../utils/local-http-server.ts";
import type localHttpServerTypes from "../../utils/local-http-server.types.ts";
import oauthPage from "../../utils/oauth-page.ts";
import type callbackServerTypes from "./callback-server.types.ts";

const { oauthErrorHtml, oauthSuccessHtml } = oauthPage;
const { startLocalHttpServer } = localHttpServer;

const page = (status: number, body: string): localHttpServerTypes.LocalHttpResponse => ({
  body,
  headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" },
  status,
});

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const redirectUriOf = <T>(
  options: callbackServerTypes.OAuthCallbackServerOptions<T>,
  port: number,
): string => {
  const redirectHost = options.redirectHost ?? options.host;
  const authority = redirectHost.includes(":") ? `[${redirectHost}]` : redirectHost;
  return `http://${authority}:${port}${options.path}`;
};

type Reply = (response: localHttpServerTypes.LocalHttpResponse) => Effect.Effect<void>;

interface CallbackFlow<T> {
  readonly options: callbackServerTypes.OAuthCallbackServerOptions<T>;
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
  { method, url }: localHttpServerTypes.LocalHttpRequest,
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

const makeFlow = <T>(options: callbackServerTypes.OAuthCallbackServerOptions<T>) =>
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
    const flow: CallbackFlow<T> = { finish, options, state };
    return { flow, onAbort, result };
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

const startOAuthCallbackServer = <T>(
  options: callbackServerTypes.OAuthCallbackServerOptions<T>,
): Effect.Effect<callbackServerTypes.OAuthCallbackServer<T>> =>
  Effect.gen(function* () {
    if (options.signal?.aborted === true) return yield* Effect.die(new Error("Login cancelled"));
    const { flow, result, onAbort } = yield* makeFlow(options);
    const server = yield* startLocalHttpServer({
      baseUrl: "http://localhost",
      closeConnections: false,
      handle: (request, reply) => handleCallback(flow, request, reply),
      host: options.host,
      onError: (error) => flow.finish(Exit.die(error)),
      port: options.port,
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    yield* startTimeout(flow, result);
    return {
      cancel: Effect.suspend(() =>
        flow.state.claimed ? Effect.void : flow.finish(Exit.succeed(undefined)),
      ),
      close: Effect.andThen(
        flow.finish(Exit.die(new Error("OAuth callback server closed"))),
        server.close,
      ),
      redirectUri: redirectUriOf(options, server.port),
      wait: Deferred.await(result),
    };
  });

const promptManualInput = <T>(
  {
    interaction,
    callback,
    message,
    placeholder,
  }: callbackServerTypes.CallbackOrManualInputOptions<T>,
  failure: { cause: Cause.Cause<never> | undefined },
  signal: AbortSignal,
): Effect.Effect<string | undefined> => {
  const cancelCallback = callback === undefined ? Effect.void : callback.cancel;
  return Effect.promise(() =>
    interaction.prompt({ message, placeholder, signal, type: "manual_code" }),
  ).pipe(
    Effect.matchCauseEffect({
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
      onSuccess: (input) => Effect.as(cancelCallback, input),
    }),
  );
};

const waitForCallbackOrManualInput = <T>(
  options: callbackServerTypes.CallbackOrManualInputOptions<T>,
): Effect.Effect<callbackServerTypes.CallbackOrManualInput<T>> =>
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
      return { input: input ?? "", type: "manual" as const };
    }).pipe(Effect.ensuring(Fiber.interrupt(manual)));
  }).pipe(Effect.scoped);

const callbackServer = {
  startOAuthCallbackServer,
  waitForCallbackOrManualInput,
};

export default callbackServer;
