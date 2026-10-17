import { Effect, Function } from "effect";

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
