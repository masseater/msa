import { Cause, Effect, Exit, Function } from "effect";
import { expect } from "vite-plus/test";

import {
  type OAuthCallbackServerOptions,
  startOAuthCallbackServer,
} from "../src/auth/oauth/callback-server.ts";
import { httpRequest } from "../src/utils/http.ts";

export const callbackUrl: {
  (params: Record<string, string>): (redirectUri: string) => string;
  (redirectUri: string, params: Record<string, string>): string;
} = Function.dual(2, (redirectUri: string, params: Record<string, string>): string => {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
});

interface CallbackRequest {
  readonly url: string | URL;
  readonly method: "GET" | "POST";
}

export const send = ({ url, method }: CallbackRequest) =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({ url, method });
    return {
      status: reply.status,
      contentType: reply.header("content-type"),
      body: yield* reply.text,
    };
  });

export const request = (url: string | URL) => send({ url, method: "GET" });

export const defectOf = <A, R>(
  effect: Effect.Effect<A, never, R>,
): Effect.Effect<unknown, never, R> =>
  Effect.flatMap(Effect.exit(effect), (exit) =>
    Exit.isFailure(exit)
      ? Effect.succeed(Cause.squash(exit.cause))
      : Effect.die(new Error("expected the effect to fail")),
  );

export const expectDefect: {
  (message: string): <A, R>(effect: Effect.Effect<A, never, R>) => Effect.Effect<void, never, R>;
  <A, R>(effect: Effect.Effect<A, never, R>, message: string): Effect.Effect<void, never, R>;
} = Function.dual(
  2,
  <A, R>(effect: Effect.Effect<A, never, R>, message: string): Effect.Effect<void, never, R> =>
    Effect.map(defectOf(effect), (defect) => {
      expect(defect).toBeInstanceOf(Error);
      expect((defect as Error).message).toContain(message);
    }),
);

export const start = (overrides: Partial<OAuthCallbackServerOptions<string>> = {}) =>
  Effect.acquireRelease(
    startOAuthCallbackServer<string>({
      providerName: "Example",
      host: "127.0.0.1",
      port: 0,
      path: "/callback",
      state: "expected-state",
      complete: (code) => Effect.succeed(`completed:${code}`),
      ...overrides,
    }),
    (server) => server.close,
  );
