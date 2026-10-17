import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { openRouterOAuth } from "../src/auth/oauth/openrouter.ts";
import { createModels } from "../src/models.ts";
import { openrouterProvider } from "../src/providers/openrouter.ts";

const TOKEN_URL = "https://openrouter.ai/api/v1/auth/keys";
const nativeFetch = globalThis.fetch;
const requestCallback = (input: string | URL, init?: RequestInit) => nativeFetch(input, init);
const neverAbortedSignal = new AbortController().signal;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

describe("OpenRouter OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("is exposed alongside API-key auth", () => {
    const provider = openrouterProvider();
    expect(provider.auth.apiKey).toBeDefined();
    expect(provider.auth.oauth).toBeDefined();
    expect(provider.auth.oauth?.loginLabel).toBe("Sign in with OpenRouter");
  });

  it("resolves the same stored OAuth key for chat and image models", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const credentials = new InMemoryCredentialStore();
        yield* Effect.promise(() =>
          credentials.modify("openrouter", () =>
            Promise.resolve({
              type: "oauth",
              access: "sk-or-stored",
              refresh: "",
              expires: Number.MAX_SAFE_INTEGER,
            }),
          ),
        );

        const models = createModels({ credentials });
        models.setProvider(openrouterProvider());
        const chatModel = models.getModels("openrouter")[0];
        const imageModel = models.getModelsOfType("image", "openrouter")[0];
        expect(chatModel).toBeDefined();
        expect(imageModel).toBeDefined();
        if (chatModel === undefined || imageModel === undefined)
          throw new Error("Expected OpenRouter chat and image models");

        expect((yield* Effect.promise(() => models.getAuth(chatModel)))?.auth.apiKey).toBe(
          "sk-or-stored",
        );
        expect((yield* Effect.promise(() => models.getAuth(imageModel)))?.auth.apiKey).toBe(
          "sk-or-stored",
        );
      }),
    ));
});

const runsPKCEOnAOneShotFirst = Effect.fn("runsPKCEOnAOneShotFirst")(function* () {
  let exchangeBody: Record<string, unknown> | undefined;
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== TOKEN_URL) return Promise.resolve(nativeFetch(input, init));
    exchangeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(jsonResponse({ key: "sk-or-test" }));
  });
  vi.stubGlobal("fetch", fetchMock);

  let authorizeUrl: URL | undefined;
  let callbackResponse: Promise<Response> | undefined;
  let manualSignal: AbortSignal | undefined;
  const credential = yield* Effect.promise(() =>
    openRouterOAuth.login({
      signal: neverAbortedSignal,
      prompt: (prompt) => {
        manualSignal = prompt.signal;
        return new Promise<string>(() => {});
      },
      notify: (event) => {
        if (event.type !== "auth_url") return;
        authorizeUrl = new URL(event.url);
        const callbackUrl = new URL(authorizeUrl.searchParams.get("callback_url") ?? "");
        callbackUrl.searchParams.set("code", "authorization-code");
        callbackResponse = requestCallback(callbackUrl);
      },
    }),
  );
  return { credential, callbackResponse, manualSignal, authorizeUrl, exchangeBody, fetchMock };
});

const runsPKCEOnAOneShotRest = Effect.fn("runsPKCEOnAOneShotRest")(function* ({
  credential,
  callbackResponse,
  manualSignal,
  authorizeUrl,
  exchangeBody,
  fetchMock,
}: Effect.Success<ReturnType<typeof runsPKCEOnAOneShotFirst>>) {
  expect(credential).toEqual({
    type: "oauth",
    access: "sk-or-test",
    refresh: "",
    expires: Number.MAX_SAFE_INTEGER,
  });
  expect((yield* Effect.promise(() => Promise.resolve(callbackResponse)))?.status).toBe(200);
  expect(manualSignal?.aborted).toBe(true);
  expect(authorizeUrl?.origin).toBe("https://openrouter.ai");
  expect(authorizeUrl?.pathname).toBe("/auth");
  expect(authorizeUrl?.searchParams.get("code_challenge_method")).toBe("S256");

  const callbackUrl = new URL(authorizeUrl?.searchParams.get("callback_url") ?? "");
  expect(callbackUrl.hostname).toBe("127.0.0.1");
  expect(callbackUrl.pathname).toMatch(/^\/oauth\/callback\/[0-9a-f-]+$/u);

  expect(exchangeBody).toMatchObject({
    code: "authorization-code",
    code_challenge_method: "S256",
  });
  const verifier = exchangeBody?.["code_verifier"];
  expect(typeof verifier).toBe("string");
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(verifier))),
  );
  expect(authorizeUrl?.searchParams.get("code_challenge")).toBe(base64url(new Uint8Array(digest)));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

describe("OpenRouter OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("runs PKCE on a one-shot loopback callback and exchanges the code for a permanent API key", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const {
          credential,
          callbackResponse,
          manualSignal,
          authorizeUrl,
          exchangeBody,
          fetchMock,
        } = yield* runsPKCEOnAOneShotFirst();
        return yield* runsPKCEOnAOneShotRest({
          credential,
          callbackResponse,
          manualSignal,
          authorizeUrl,
          exchangeBody,
          fetchMock,
        });
      }),
    ));
});

describe("OpenRouter OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("reports token exchange failures through both the callback page and login", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(() => Promise.resolve(jsonResponse({ error: { message: "invalid code" } }, 403))),
        );

        let callbackResponse: Promise<Response> | undefined;
        const login = openRouterOAuth.login({
          signal: neverAbortedSignal,
          prompt: () => new Promise<string>(() => {}),
          notify: (event) => {
            if (event.type !== "auth_url") return;
            const callbackUrl = new URL(new URL(event.url).searchParams.get("callback_url") ?? "");
            callbackUrl.searchParams.set("code", "bad-code");
            callbackResponse = requestCallback(callbackUrl);
          },
        });

        yield* Effect.promise(() =>
          expect(login).rejects.toThrow(
            "OpenRouter OAuth key exchange failed (HTTP 403): invalid code",
          ),
        );
        expect((yield* Effect.promise(() => Promise.resolve(callbackResponse)))?.status).toBe(502);
      }),
    ));
});

describe("OpenRouter OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("allows only one token exchange for a callback", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let completeExchange = (_response: Response): void => {
          throw new Error("Token exchange did not start");
        };
        const fetchMock = vi.fn(() =>
          Promise.resolve(
            new Promise<Response>((resolve) => {
              completeExchange = resolve;
            }),
          ),
        );
        vi.stubGlobal("fetch", fetchMock);

        let callbackUrl: URL | undefined;
        let firstCallback: Promise<Response> | undefined;
        const login = openRouterOAuth.login({
          signal: neverAbortedSignal,
          prompt: () => new Promise<string>(() => {}),
          notify: (event) => {
            if (event.type !== "auth_url") return;
            callbackUrl = new URL(new URL(event.url).searchParams.get("callback_url") ?? "");
            callbackUrl.searchParams.set("code", "authorization-code");
            firstCallback = requestCallback(callbackUrl);
          },
        });

        yield* Effect.promise(() => vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)));
        const receivedCallbackUrl = callbackUrl;
        if (receivedCallbackUrl === undefined)
          throw new Error("OpenRouter did not provide a callback URL");
        expect((yield* Effect.promise(() => requestCallback(receivedCallbackUrl))).status).toBe(
          409,
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        completeExchange(jsonResponse({ key: "sk-or-test" }));

        yield* Effect.promise(() => expect(login).resolves.toMatchObject({ access: "sk-or-test" }));
        expect((yield* Effect.promise(() => Promise.resolve(firstCallback)))?.status).toBe(200);
      }),
    ));
});

describe("OpenRouter OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("rejects a successful response that does not contain a key", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(() => Promise.resolve(jsonResponse({ user_id: "user-1" }))),
        );

        let callbackResponse: Promise<Response> | undefined;
        const login = openRouterOAuth.login({
          signal: neverAbortedSignal,
          prompt: () => new Promise<string>(() => {}),
          notify: (event) => {
            if (event.type !== "auth_url") return;
            const callbackUrl = new URL(new URL(event.url).searchParams.get("callback_url") ?? "");
            callbackUrl.searchParams.set("code", "code-without-key");
            callbackResponse = requestCallback(callbackUrl);
          },
        });

        yield* Effect.promise(() =>
          expect(login).rejects.toThrow('OpenRouter OAuth response carries no "key"'),
        );
        expect((yield* Effect.promise(() => Promise.resolve(callbackResponse)))?.status).toBe(502);
      }),
    ));
});

describe("OpenRouter OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("mints a key from a pasted redirect URL when the loopback callback never arrives", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let exchangeBody: Record<string, unknown> | undefined;
        const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url !== TOKEN_URL) return Promise.resolve(nativeFetch(input, init));
          exchangeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Promise.resolve(jsonResponse({ key: "sk-or-manual" }));
        });
        vi.stubGlobal("fetch", fetchMock);

        let callbackUrl: string | undefined;
        const credential = yield* Effect.promise(() =>
          openRouterOAuth.login({
            signal: neverAbortedSignal,
            prompt: (prompt) => {
              if (prompt.type !== "manual_code")
                return Promise.reject(new Error(`Unexpected prompt: ${prompt.type}`));
              return Promise.resolve(`${callbackUrl}?code=manual-code`);
            },
            notify: (event) => {
              if (event.type !== "auth_url") return;
              callbackUrl = new URL(event.url).searchParams.get("callback_url") ?? undefined;
            },
          }),
        );

        expect(credential).toEqual({
          type: "oauth",
          access: "sk-or-manual",
          refresh: "",
          expires: Number.MAX_SAFE_INTEGER,
        });
        expect(exchangeBody).toMatchObject({ code: "manual-code", code_challenge_method: "S256" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }),
    ));
});

describe("OpenRouter OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("accepts a bare authorization code from the manual prompt", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let exchangeBody: Record<string, unknown> | undefined;
        const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url !== TOKEN_URL) return Promise.resolve(nativeFetch(input, init));
          exchangeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Promise.resolve(jsonResponse({ key: "sk-or-manual" }));
        });
        vi.stubGlobal("fetch", fetchMock);

        const credential = yield* Effect.promise(() =>
          openRouterOAuth.login({
            signal: neverAbortedSignal,
            prompt: () => Promise.resolve("  manual-code  "),
            notify: () => {},
          }),
        );

        expect(credential).toMatchObject({ access: "sk-or-manual" });
        expect(exchangeBody).toMatchObject({ code: "manual-code" });
      }),
    ));

  it("fails login when the manual prompt is cancelled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ key: "sk-or-unexpected" })));
        vi.stubGlobal("fetch", fetchMock);

        yield* Effect.promise(() =>
          expect(
            openRouterOAuth.login({
              signal: neverAbortedSignal,
              prompt: () => Promise.reject(new Error("Login cancelled")),
              notify: () => {},
            }),
          ).rejects.toThrow("Login cancelled"),
        );
        expect(fetchMock).not.toHaveBeenCalled();
      }),
    ));
});

describe("OpenRouter OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("rejects empty manual input without exchanging a code", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ key: "sk-or-unexpected" })));
        vi.stubGlobal("fetch", fetchMock);

        yield* Effect.promise(() =>
          expect(
            openRouterOAuth.login({
              signal: neverAbortedSignal,
              prompt: () => Promise.resolve("   "),
              notify: () => {},
            }),
          ).rejects.toThrow("Missing authorization code"),
        );
        expect(fetchMock).not.toHaveBeenCalled();
      }),
    ));

  it("closes the pending callback when login is cancelled", () => {
    const controller = new AbortController();
    return Effect.runPromise(
      Effect.gen(function* () {
        let callbackUrl: URL | undefined;
        const login = openRouterOAuth.login({
          signal: controller.signal,
          prompt: () => new Promise<string>(() => {}),
          notify: (event) => {
            if (event.type !== "auth_url") return;
            callbackUrl = new URL(new URL(event.url).searchParams.get("callback_url") ?? "");
            controller.abort();
          },
        });

        yield* Effect.promise(() => expect(login).rejects.toThrow("Login cancelled"));
        expect(callbackUrl).toBeDefined();
        yield* Effect.promise(() => expect(requestCallback(callbackUrl!)).rejects.toThrow());
      }),
    );
  });
});

describe("OpenRouter OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("rejects before opening a callback server when login is already cancelled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const controllerSignal = AbortSignal.abort();

        yield* Effect.promise(() =>
          expect(
            openRouterOAuth.login({
              signal: controllerSignal,
              prompt: () => Promise.resolve(""),
              notify: () => {
                throw new Error("Cancelled login must not emit events");
              },
            }),
          ).rejects.toThrow("Login cancelled"),
        );
      }),
    ));

  it("uses the configured OAuth callback host", () => {
    const controller = new AbortController();
    return Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("MSA_OAUTH_CALLBACK_HOST", "localhost");
        let callbackUrl: URL | undefined;
        const login = openRouterOAuth.login({
          signal: controller.signal,
          prompt: () => new Promise<string>(() => {}),
          notify: (event) => {
            if (event.type !== "auth_url") return;
            callbackUrl = new URL(new URL(event.url).searchParams.get("callback_url") ?? "");
            controller.abort();
          },
        });

        yield* Effect.promise(() => expect(login).rejects.toThrow("Login cancelled"));
        expect(callbackUrl?.hostname).toBe("localhost");
      }),
    );
  });
});
