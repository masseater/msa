import { Clock, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import openaiChatgpt from "../src/auth/oauth/openai-chatgpt.ts";
import type typesModule from "../src/auth/types.ts";

const { openaiChatGPTOAuth } = openaiChatgpt;

const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
const REQUIRED_SCOPE =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const neverAbortedSignal = new AbortController().signal;
const DEVICE_ID = "e61bbe28-07ef-466d-8e5d-a344f94ab305";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function tokenResponse(scope = REQUIRED_SCOPE) {
  return {
    access_token: "access-token",
    expires_in: 3600,
    id_token: "id-token",
    refresh_token: "refresh-token",
    scope,
  };
}

function stubTokenEndpoint(response: unknown, inspect?: (body: URLSearchParams) => void) {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    expect(input instanceof Request ? input.url : String(input)).toBe(TOKEN_URL);
    inspect?.(new URLSearchParams(String(init?.body)));
    return Promise.resolve(jsonResponse(response));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function loginInteraction(options?: {
  callbackClientId?: string;
  onAuthorize?: (url: URL) => void;
}): typesModule.ProviderAuthInteraction {
  let authorizeUrl: URL | undefined;
  return {
    notify: (event) => {
      if (event.type !== "auth_url") return;
      authorizeUrl = new URL(event.url);
      options?.onAuthorize?.(authorizeUrl);
    },
    prompt: (prompt) => {
      if (prompt.type !== "manual_code")
        return Promise.reject(new Error(`Unexpected prompt: ${prompt.type}`));
      if (authorizeUrl === undefined)
        return Promise.reject(
          new Error("Authorization URL was not emitted before the callback prompt"),
        );
      const callback = new URL(authorizeUrl.searchParams.get("redirect_uri") ?? "");
      callback.searchParams.set("code", "authorization-code");
      callback.searchParams.set("state", authorizeUrl.searchParams.get("state") ?? "");
      if (options?.callbackClientId !== undefined && options?.callbackClientId !== "")
        callback.searchParams.set("client_id", options.callbackClientId);
      return Promise.resolve(callback.toString());
    },
    signal: neverAbortedSignal,
  };
}

function connectedCredential(): typesModule.OAuthCredential {
  return {
    access: "old-access",
    clientId: "oaiapp_existing",
    expires: 0,
    refresh: "old-refresh",
    scopes: REQUIRED_SCOPE.split(" "),
    type: "oauth",
  };
}

describe("OpenAI ChatGPT OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("registers a user-owned client and stores its issued ID and granted scopes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let authorizeUrl: URL | undefined;
        let exchangeBody: URLSearchParams | undefined;
        stubTokenEndpoint(tokenResponse(), (body) => {
          exchangeBody = body;
        });

        const credential = yield* Effect.promise(() =>
          openaiChatGPTOAuth.login(
            loginInteraction({
              callbackClientId: "oaiapp_issued",
              onAuthorize: (url) => {
                authorizeUrl = url;
              },
            }),
            { getDeviceId: () => DEVICE_ID },
          ),
        );

        expect(authorizeUrl?.searchParams.get("client_id")).toBe("dynamic_agent_client");
        expect(authorizeUrl?.searchParams.get("agent_name_hint")).toBe("msa");
        expect(authorizeUrl?.searchParams.get("ext_agent_host_id")).toBe(`urn:uuid:${DEVICE_ID}`);
        expect(authorizeUrl?.searchParams.get("scope")).toBe(REQUIRED_SCOPE);
        expect(authorizeUrl?.searchParams.get("redirect_uri")).toBe(
          "http://127.0.0.1:1455/auth/callback",
        );
        expect(authorizeUrl?.searchParams.get("resource")).toBe("https://api.openai.com/v1");
        expect(authorizeUrl?.searchParams.get("code_challenge_method")).toBe("S256");
        expect(exchangeBody?.get("client_id")).toBe("oaiapp_issued");
        expect(exchangeBody?.get("code")).toBe("authorization-code");
        expect(exchangeBody?.get("resource")).toBe("https://api.openai.com/v1");
        expect(exchangeBody?.get("code_verifier")).toBeTruthy();
        expect(credential).toMatchObject({
          access: "access-token",
          clientId: "oaiapp_issued",
          refresh: "refresh-token",
          scopes: REQUIRED_SCOPE.split(" "),
          type: "oauth",
        });
      }),
    ));
});

describe("OpenAI ChatGPT OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("uses the app's agent name as the name hint", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let authorizeUrl: URL | undefined;
        stubTokenEndpoint(tokenResponse());

        yield* Effect.promise(() =>
          openaiChatGPTOAuth.login(
            loginInteraction({
              callbackClientId: "oaiapp_issued",
              onAuthorize: (url) => {
                authorizeUrl = url;
              },
            }),
            { agentName: "my-app", getDeviceId: () => DEVICE_ID },
          ),
        );

        expect(authorizeUrl?.searchParams.get("agent_name_hint")).toBe("my-app");
      }),
    ));

  it("rejects registration without an issued client ID", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fetchMock = stubTokenEndpoint(tokenResponse());

        yield* Effect.promise(() =>
          expect(
            openaiChatGPTOAuth.login(loginInteraction(), { getDeviceId: () => DEVICE_ID }),
          ).rejects.toThrow("registration callback did not contain an issued client ID"),
        );
        expect(fetchMock).not.toHaveBeenCalled();
      }),
    ));
});

describe("OpenAI ChatGPT OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("rejects a token response that did not grant direct token use", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        stubTokenEndpoint(tokenResponse("openid profile email offline_access resource.invoke"));

        yield* Effect.promise(() =>
          expect(
            openaiChatGPTOAuth.login(loginInteraction({ callbackClientId: "oaiapp_issued" }), {
              getDeviceId: () => DEVICE_ID,
            }),
          ).rejects.toThrow("grant did not include chatgpt.tokens.use.direct"),
        );
      }),
    ));

  it("requires a device ID before starting authorization", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let authorizationStarted = false;
        const interaction = loginInteraction({
          onAuthorize: () => {
            authorizationStarted = true;
          },
        });

        yield* Effect.promise(() =>
          expect(openaiChatGPTOAuth.login(interaction)).rejects.toThrow("requires a device ID"),
        );
        yield* Effect.promise(() =>
          expect(
            openaiChatGPTOAuth.login(interaction, { getDeviceId: () => "not-a-uuid" }),
          ).rejects.toThrow("requires a device ID"),
        );
        expect(authorizationStarted).toBe(false);
      }),
    ));
});

describe("OpenAI ChatGPT OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("requires refresh responses to rotate the refresh token", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { refresh_token: _refreshToken, ...responseWithoutRefresh } = tokenResponse();
        stubTokenEndpoint(responseWithoutRefresh);

        yield* Effect.promise(() =>
          expect(
            openaiChatGPTOAuth.refresh(connectedCredential(), neverAbortedSignal),
          ).rejects.toThrow("token response has invalid refresh_token"),
        );
      }),
    ));
});

describe("OpenAI ChatGPT OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("refreshes with the credential's issued client ID and stores replacement scopes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let refreshBody: URLSearchParams | undefined;
        stubTokenEndpoint(
          { ...tokenResponse(), access_token: "new-access", refresh_token: "new-refresh" },
          (body) => {
            refreshBody = body;
          },
        );

        const before = yield* Clock.currentTimeMillis;
        const credential = yield* Effect.promise(() =>
          openaiChatGPTOAuth.refresh(connectedCredential(), neverAbortedSignal),
        );

        expect(credential.expires).toBeGreaterThanOrEqual(before + (3600 - 180) * 1000);
        expect(credential.expires).toBeLessThanOrEqual(
          (yield* Clock.currentTimeMillis) + (3600 - 180) * 1000,
        );

        expect(refreshBody?.get("grant_type")).toBe("refresh_token");
        expect(refreshBody?.get("client_id")).toBe("oaiapp_existing");
        expect(refreshBody?.get("refresh_token")).toBe("old-refresh");
        expect(refreshBody?.get("resource")).toBe("https://api.openai.com/v1");
        expect(refreshBody?.has("scope")).toBe(false);
        expect(credential).toMatchObject({
          access: "new-access",
          clientId: "oaiapp_existing",
          refresh: "new-refresh",
          scopes: REQUIRED_SCOPE.split(" "),
        });
      }),
    ));
});
