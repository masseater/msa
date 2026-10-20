import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiCodex from "../src/auth/oauth/openai-codex.ts";
import localHttpServer from "../src/utils/local-http-server.ts";
import openaiCodexOauthSupport from "./openai-codex-oauth-support.ts";

const { openaiCodexOAuth } = openaiCodex;
const { startLocalHttpServer } = localHttpServer;

const { createAccessToken, jsonResponse, neverAbortedSignal, restoreAfterEach, stubOpenAIAuth } =
  openaiCodexOauthSupport;

const failsRefreshQuietly = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const message = "Could not validate your token. Please try signing in again.";
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(jsonResponse({ error: { message, type: "invalid_request_error" } }, 401)),
        ),
      );
      yield* Effect.promise(() =>
        expect(
          openaiCodexOAuth.refresh(
            {
              access: "invalid-access-token",
              expires: 0,
              refresh: "invalid-refresh-token",
              type: "oauth",
            },
            neverAbortedSignal,
          ),
        ).rejects.toThrow(
          /OpenAI Codex token refresh failed \(401\).*Could not validate your token/u,
        ),
      );
      expect(consoleError).not.toHaveBeenCalled();
    }),
  );

const loginByPastingRedirect = (agentName?: string) => {
  const authUrl = Promise.withResolvers<URL>();
  const credential = openaiCodexOAuth.login(
    {
      notify: (event) => {
        if (event.type === "auth_url") authUrl.resolve(new URL(event.url));
      },
      prompt: (prompt) => {
        if (prompt.type === "select") return Promise.resolve("browser");
        if (prompt.type !== "manual_code") {
          return Promise.reject(new Error(`Unexpected prompt: ${prompt.type}`));
        }
        return authUrl.promise.then(
          (url) =>
            `http://localhost:1455/auth/callback?code=pasted-code&state=${url.searchParams.get("state")}`,
        );
      },
      signal: neverAbortedSignal,
    },
    agentName === undefined ? undefined : { agentName },
  );
  return { authUrl: authUrl.promise, credential };
};

const usesAgentNameAsOriginator = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      stubOpenAIAuth({
        accessToken: createAccessToken("acct"),
        interval: "5",
        poll: () => undefined,
      });
      const run = loginByPastingRedirect("my-app");
      yield* Effect.promise(() => run.credential);
      const authUrl = yield* Effect.promise(() => run.authUrl);
      expect(authUrl.searchParams.get("originator")).toBe("my-app");
    }),
  );

const occupyCallbackPort = Effect.acquireRelease(
  startLocalHttpServer({
    baseUrl: "http://localhost",
    closeConnections: true,
    handle: (_request, reply) => reply({ body: "", headers: {}, status: 503 }),
    host: "127.0.0.1",
    onError: () => Effect.void,
    port: 1455,
  }),
  (server) => server.close,
).pipe(Effect.exit);

const fallsBackToPastedRedirect = () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* occupyCallbackPort;
        const auth = stubOpenAIAuth({
          accessToken: createAccessToken("acct"),
          interval: "5",
          poll: () => undefined,
        });
        const credential = yield* Effect.promise(() => loginByPastingRedirect().credential);

        expect(credential["accountId"]).toBe("acct");
        expect(auth.requests.map((request) => request.url)).toEqual([
          "https://auth.openai.com/oauth/token",
        ]);
        expect(auth.exchanges[0]?.get("code")).toBe("pasted-code");
        expect(auth.exchanges[0]?.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
      }),
    ),
  );

describe("OpenAI Codex OAuth browser login", () => {
  restoreAfterEach();

  it("does not write token refresh failures to stderr", failsRefreshQuietly);
  it("uses the app's agent name as the browser login originator", usesAgentNameAsOriginator);
  it(
    "falls back to the pasted redirect URL when the fixed callback port is taken",
    fallsBackToPastedRedirect,
  );
});
