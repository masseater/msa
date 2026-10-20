import { Effect, Function } from "effect";

import {
  type OAuthCallbackServerOptions,
  startOAuthCallbackServer,
} from "../src/auth/oauth/callback-server.ts";
import { httpRequest } from "../src/utils/http.ts";

const callbackUrl: {
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

const send = ({ url, method }: CallbackRequest) =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({ method, url });
    return {
      body: yield* reply.text,
      contentType: reply.header("content-type"),
      status: reply.status,
    };
  });

const request = (url: string | URL) => send({ method: "GET", url });

const start = (overrides: Partial<OAuthCallbackServerOptions<string>> = {}) =>
  Effect.acquireRelease(
    startOAuthCallbackServer<string>({
      complete: (code) => Effect.succeed(`completed:${code}`),
      host: "127.0.0.1",
      path: "/callback",
      port: 0,
      providerName: "Example",
      state: "expected-state",
      ...overrides,
    }),
    (server) => server.close,
  );

const oauthCallback = {
  callbackUrl,
  request,
  send,
  start,
};

export default oauthCallback;
