import { Effect } from "effect";
import { afterEach, vi } from "vite-plus/test";

import openrouter from "../src/auth/oauth/openrouter.ts";
import jsonCodec from "./json-codec.ts";
import loopbackFetch from "./loopback-fetch.ts";

const { openRouterOAuth } = openrouter;

const { decodeJson } = jsonCodec;

const neverAbortedSignal: AbortSignal = new AbortController().signal;

const waitForever = () => Effect.runPromise(Effect.never);

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { headers: { "content-type": "application/json" }, status });

const permanentKey = (access: string) => ({
  access,
  expires: Number.MAX_SAFE_INTEGER,
  refresh: "",
  type: "oauth" as const,
});

const callbackUrlOf = (authorizeUrl: URL) =>
  new URL(authorizeUrl.searchParams.get("callback_url") ?? "");

const stubTokenExchange = (reply: () => Response | Promise<Response>) => {
  const bodies: string[] = [];
  const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return Promise.resolve(reply());
  });
  vi.stubGlobal("fetch", fetchMock);
  const exchanges = Effect.suspend(() => Effect.forEach(bodies, (body) => decodeJson(body)));
  return { exchanges, fetchMock };
};

const loginThroughCallback = (code: string) => {
  const authorizeUrl = Promise.withResolvers<URL>();
  const callbackResponse = Promise.withResolvers<Response>();
  const promptSignal = Promise.withResolvers<AbortSignal | undefined>();
  const login = openRouterOAuth.login({
    notify: (event) => {
      if (event.type !== "auth_url") return;
      const url = new URL(event.url);
      authorizeUrl.resolve(url);
      const callbackUrl = callbackUrlOf(url);
      callbackUrl.searchParams.set("code", code);
      callbackResponse.resolve(loopbackFetch(callbackUrl));
    },
    prompt: (prompt) => {
      promptSignal.resolve(prompt.signal);
      return waitForever();
    },
    signal: neverAbortedSignal,
  });
  return {
    authorizeUrl: authorizeUrl.promise,
    callbackResponse: callbackResponse.promise,
    login,
    promptSignal: promptSignal.promise,
  };
};

const cancelAtAuthUrl = () => {
  const controller = new AbortController();
  const callbackUrl = Promise.withResolvers<URL>();
  const login = openRouterOAuth.login({
    notify: (event) => {
      if (event.type !== "auth_url") return;
      callbackUrl.resolve(callbackUrlOf(new URL(event.url)));
      controller.abort();
    },
    prompt: waitForever,
    signal: controller.signal,
  });
  return { callbackUrl: callbackUrl.promise, login };
};

const restoreStubsAfterEach = () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
};

const openrouterOauthSupport = {
  callbackUrlOf,
  cancelAtAuthUrl,
  jsonResponse,
  loginThroughCallback,
  neverAbortedSignal,
  permanentKey,
  restoreStubsAfterEach,
  stubTokenExchange,
};

export default openrouterOauthSupport;
