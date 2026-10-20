import { Effect } from "effect";
import { afterEach, vi } from "vite-plus/test";

import { openaiCodexOAuth } from "../src/auth/oauth/openai-codex.ts";
import type { AuthEvent } from "../src/auth/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

type DeviceCodeInfo = Omit<Extract<AuthEvent, { type: "device_code" }>, "type">;

const USERCODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

const neverAbortedSignal = new AbortController().signal;

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { headers: { "Content-Type": "application/json" }, status });

const requestUrl = (input: string | URL | Request): string =>
  input instanceof Request ? input.url : input.toString();

const base64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64");

const createAccessToken = (accountId: string): string =>
  `${base64({ alg: "none" })}.${base64({
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })}.signature`;

const deviceAuthPendingResponse = (): Response =>
  jsonResponse(
    {
      error: {
        code: "deviceauth_authorization_pending",
        message: "Device authorization is pending. Please try again.",
        param: null,
        type: "invalid_request_error",
      },
    },
    403,
  );

const deviceAuthorization = () =>
  jsonResponse({
    authorization_code: "oauth-code",
    code_challenge: "device-code-challenge",
    code_verifier: "device-code-verifier",
  });

const issuedTokens = (accessToken: string) =>
  jsonResponse({ access_token: accessToken, expires_in: 3600, refresh_token: "refresh-token" });

interface FakeAuthServer {
  readonly accessToken?: string;
  readonly interval: string;
  readonly poll: () => Response | undefined;
  readonly userCode?: string;
}

const stubOpenAIAuth = (server: FakeAuthServer) => {
  const recorded = {
    exchanges: [] as URLSearchParams[],
    pollTimes: [] as number[],
    requests: [] as { body: string; headers: unknown; method: string | undefined; url: string }[],
  };
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    recorded.requests.push({
      body: String(init?.body),
      headers: init?.headers,
      method: init?.method,
      url,
    });
    if (url === USERCODE_URL) {
      return Promise.resolve(
        jsonResponse({
          device_auth_id: "device-auth-id",
          interval: server.interval,
          user_code: server.userCode ?? "ABCD-1234",
        }),
      );
    }
    if (url === DEVICE_TOKEN_URL) {
      recorded.pollTimes.push(currentTimeMillis());
      const response = server.poll();
      return response === undefined
        ? Promise.reject(new Error("Unexpected extra device auth poll"))
        : Promise.resolve(response);
    }
    if (url === OAUTH_TOKEN_URL && server.accessToken !== undefined) {
      recorded.exchanges.push(new URLSearchParams(String(init?.body)));
      return Promise.resolve(issuedTokens(server.accessToken));
    }
    return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return recorded;
};

const respondInTurn = (responses: Response[]) => () => responses.shift();

const loginWithDeviceCode = (signal: AbortSignal = neverAbortedSignal) => {
  const deviceInfos: DeviceCodeInfo[] = [];
  const login = openaiCodexOAuth.login({
    notify: (event) => {
      if (event.type !== "device_code") return;
      const { type: _type, ...info } = event;
      deviceInfos.push(info);
    },
    prompt: (prompt) =>
      prompt.type === "select"
        ? Promise.resolve("device_code")
        : Promise.reject(new Error(`Unexpected prompt: ${prompt.type}`)),
    signal,
  });
  return { deviceInfos, login };
};

const untilFirstPoll = (pollTimes: readonly number[]) =>
  Effect.promise(() => vi.advanceTimersByTimeAsync(0)).pipe(
    Effect.repeat({ times: 4, while: () => pollTimes.length === 0 }),
  );

const advanceTimers = (ms: number) => Effect.promise(() => vi.advanceTimersByTimeAsync(ms));

const failureOf = (login: Promise<unknown>) => {
  const settled = login.then(
    () => new Error("Expected login to fail"),
    (error: unknown) => error,
  );
  return Effect.promise(() => settled);
};

const restoreAfterEach = () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
};

const openaiCodexOauthSupport = {
  CLIENT_ID,
  advanceTimers,
  createAccessToken,
  deviceAuthPendingResponse,
  deviceAuthorization,
  failureOf,
  jsonResponse,
  loginWithDeviceCode,
  neverAbortedSignal,
  requestUrl,
  respondInTurn,
  restoreAfterEach,
  stubOpenAIAuth,
  untilFirstPoll,
  urls: { DEVICE_TOKEN_URL, OAUTH_TOKEN_URL, USERCODE_URL },
};

export default openaiCodexOauthSupport;
