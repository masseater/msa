import { createServer } from "node:http";

import { DateTime, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { openaiCodexOAuth } from "../src/auth/oauth/openai-codex.ts";
import type { AuthEvent } from "../src/auth/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

const neverAbortedSignal = new AbortController().signal;

type DeviceCodeInfo = Omit<Extract<AuthEvent, { type: "device_code" }>, "type">;

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  throw new Error(`Unsupported fetch input: ${String(input)}`);
}

function createAccessToken(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64");
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
      },
    }),
  ).toString("base64");
  return `${header}.${payload}.signature`;
}

function deviceAuthPendingResponse(): Response {
  return jsonResponse(
    {
      error: {
        message: "Device authorization is pending. Please try again.",
        type: "invalid_request_error",
        param: null,
        code: "deviceauth_authorization_pending",
      },
    },
    403,
  );
}

function loginOpenAICodexDeviceCodeForTest(options: {
  onDeviceCode(info: DeviceCodeInfo): void;
  signal?: AbortSignal;
}) {
  return openaiCodexOAuth.login({
    signal: options.signal ?? neverAbortedSignal,
    prompt: (prompt) => {
      if (prompt.type !== "select")
        return Promise.reject(new Error(`Unexpected prompt: ${prompt.type}`));
      return Promise.resolve("device_code");
    },
    notify: (event) => {
      if (event.type === "device_code") {
        const { type: _, ...info } = event;
        options.onDeviceCode(info);
      }
    },
  });
}

const logsInWithTheOpenAICodexFirst2 = () =>
  Effect.sync(() => {
    vi.useFakeTimers();
    const startTime = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-05-20T00:00:00Z"));
    vi.setSystemTime(startTime);

    const accessToken = createAccessToken("account-123");
    const deviceInfos: DeviceCodeInfo[] = [];
    const pollTimes: number[] = [];
    const pollResponses = [
      deviceAuthPendingResponse(),
      jsonResponse({
        authorization_code: "oauth-code",
        code_challenge: "device-code-challenge",
        code_verifier: "device-code-verifier",
      }),
    ];
    return { pollTimes, pollResponses, accessToken, deviceInfos, startTime };
  });

const logsInWithTheOpenAICodexFirst6 = (
  pollTimes: number[],
  pollResponses: Response[],
  accessToken: string,
) =>
  Effect.sync(() => {
    const fetchMock = vi.fn((input: unknown, init?: RequestInit): Promise<Response> => {
      const url = getUrl(input);

      if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({ "content-type": "application/json" });
        expect(JSON.parse(String(init?.body))).toEqual({
          client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        });
        return Promise.resolve(
          jsonResponse({
            device_auth_id: "device-auth-id",
            user_code: "ABCD-1234",
            interval: "5",
          }),
        );
      }

      if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
        pollTimes.push(currentTimeMillis());
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({ "content-type": "application/json" });
        expect(JSON.parse(String(init?.body))).toEqual({
          device_auth_id: "device-auth-id",
          user_code: "ABCD-1234",
        });
        const response = pollResponses.shift();
        if (response === undefined) {
          return Promise.reject(new Error("Unexpected extra device auth poll"));
        }
        return Promise.resolve(response);
      }

      if (url === "https://auth.openai.com/oauth/token") {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          "content-type": "application/x-www-form-urlencoded",
        });
        const params = new URLSearchParams(String(init?.body));
        expect(params.get("grant_type")).toBe("authorization_code");
        expect(params.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
        expect(params.get("code")).toBe("oauth-code");
        expect(params.get("redirect_uri")).toBe("https://auth.openai.com/deviceauth/callback");
        expect(params.get("code_verifier")).toBe("device-code-verifier");
        return Promise.resolve(
          jsonResponse({
            access_token: accessToken,
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
        );
      }

      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });
    return { fetchMock };
  });

const logsInWithTheOpenAICodexRest6 = ({
  fetchMock,
}: Effect.Success<ReturnType<typeof logsInWithTheOpenAICodexFirst6>>) =>
  Effect.sync(() => ({ fetchMock }));

const logsInWithTheOpenAICodexFirst5 = Effect.fn("logsInWithTheOpenAICodexFirst5")(function* (
  pollTimes: number[],
  pollResponses: Response[],
  accessToken: string,
) {
  const { fetchMock } = yield* logsInWithTheOpenAICodexFirst6(
    pollTimes,
    pollResponses,
    accessToken,
  );
  return yield* logsInWithTheOpenAICodexRest6({ fetchMock });
});

const logsInWithTheOpenAICodexRest5 = ({
  fetchMock,
}: Effect.Success<ReturnType<typeof logsInWithTheOpenAICodexFirst5>>) =>
  Effect.sync(() => ({ fetchMock }));

const logsInWithTheOpenAICodexFirst4 = Effect.fn("logsInWithTheOpenAICodexFirst4")(function* (
  pollTimes: number[],
  pollResponses: Response[],
  accessToken: string,
) {
  const { fetchMock } = yield* logsInWithTheOpenAICodexFirst5(
    pollTimes,
    pollResponses,
    accessToken,
  );
  return yield* logsInWithTheOpenAICodexRest5({ fetchMock });
});

const logsInWithTheOpenAICodexRest4 = ({
  fetchMock,
}: Effect.Success<ReturnType<typeof logsInWithTheOpenAICodexFirst4>>) =>
  Effect.sync(() => ({ fetchMock }));

const logsInWithTheOpenAICodexFirst3 = Effect.fn("logsInWithTheOpenAICodexFirst3")(function* (
  pollTimes: number[],
  pollResponses: Response[],
  accessToken: string,
) {
  const { fetchMock } = yield* logsInWithTheOpenAICodexFirst4(
    pollTimes,
    pollResponses,
    accessToken,
  );
  return yield* logsInWithTheOpenAICodexRest4({ fetchMock });
});

const logsInWithTheOpenAICodexRest3 = (
  pollTimes: number[],
  accessToken: string,
  deviceInfos: DeviceCodeInfo[],
  startTime: number,
  { fetchMock }: Effect.Success<ReturnType<typeof logsInWithTheOpenAICodexFirst3>>,
) => Effect.sync(() => ({ fetchMock, deviceInfos, pollTimes, startTime, accessToken }));

const logsInWithTheOpenAICodexRest2 = Effect.fn("logsInWithTheOpenAICodexRest2")(function* ({
  pollTimes,
  pollResponses,
  accessToken,
  deviceInfos,
  startTime,
}: Effect.Success<ReturnType<typeof logsInWithTheOpenAICodexFirst2>>) {
  const { fetchMock } = yield* logsInWithTheOpenAICodexFirst3(
    pollTimes,
    pollResponses,
    accessToken,
  );
  return yield* logsInWithTheOpenAICodexRest3(pollTimes, accessToken, deviceInfos, startTime, {
    fetchMock,
  });
});

const logsInWithTheOpenAICodexFirst = Effect.fn("logsInWithTheOpenAICodexFirst")(function* () {
  const { pollTimes, pollResponses, accessToken, deviceInfos, startTime } =
    yield* logsInWithTheOpenAICodexFirst2();
  return yield* logsInWithTheOpenAICodexRest2({
    pollTimes,
    pollResponses,
    accessToken,
    deviceInfos,
    startTime,
  });
});

const logsInWithTheOpenAICodexRest = Effect.fn("logsInWithTheOpenAICodexRest")(function* ({
  fetchMock,
  deviceInfos,
  pollTimes,
  startTime,
  accessToken,
}: Effect.Success<ReturnType<typeof logsInWithTheOpenAICodexFirst>>) {
  vi.stubGlobal("fetch", fetchMock);

  const credentialsPromise = loginOpenAICodexDeviceCodeForTest({
    onDeviceCode: (info) => deviceInfos.push(info),
  });

  for (let i = 0; i < 5 && pollTimes.length === 0; i++) {
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
  }
  expect(deviceInfos).toEqual([
    {
      userCode: "ABCD-1234",
      verificationUri: "https://auth.openai.com/codex/device",
      intervalSeconds: 5,
      expiresInSeconds: 900,
    },
  ]);
  expect(pollTimes).toEqual([startTime]);

  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(4999));
  expect(pollTimes).toEqual([startTime]);

  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));
  yield* Effect.promise(() =>
    expect(credentialsPromise).resolves.toMatchObject({
      access: accessToken,
      refresh: "refresh-token",
      expires: startTime + 5000 + 3600 * 1000,
      accountId: "account-123",
    }),
  );
  expect(pollTimes).toEqual([startTime, startTime + 5000]);
});

describe("OpenAI Codex OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("logs in with the OpenAI Codex device code flow", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { fetchMock, deviceInfos, pollTimes, startTime, accessToken } =
          yield* logsInWithTheOpenAICodexFirst();
        return yield* logsInWithTheOpenAICodexRest({
          fetchMock,
          deviceInfos,
          pollTimes,
          startTime,
          accessToken,
        });
      }),
    ));
});

const offersBrowserLoginFirstAndUsesFirst = () =>
  Effect.sync(() => {
    const accessToken = createAccessToken("account-456");
    const selectPrompts: Array<{
      message: string;
      options: readonly { id: string; label: string }[];
    }> = [];
    const deviceInfos: DeviceCodeInfo[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, init?: RequestInit): Promise<Response> => {
        const url = getUrl(input);
        if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
          expect(JSON.parse(String(init?.body))).toEqual({
            client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
          });
          return Promise.resolve(
            jsonResponse({
              device_auth_id: "device-auth-id",
              user_code: "WXYZ-7890",
              interval: "5",
            }),
          );
        }
        if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
          return Promise.resolve(
            jsonResponse({
              authorization_code: "oauth-code",
              code_challenge: "device-code-challenge",
              code_verifier: "device-code-verifier",
            }),
          );
        }
        if (url === "https://auth.openai.com/oauth/token") {
          return Promise.resolve(
            jsonResponse({
              access_token: accessToken,
              refresh_token: "refresh-token",
              expires_in: 3600,
            }),
          );
        }
        return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
      }),
    );
    return { selectPrompts, deviceInfos, accessToken };
  });

const offersBrowserLoginFirstAndUsesRest = Effect.fn("offersBrowserLoginFirstAndUsesRest")(
  function* ({
    selectPrompts,
    deviceInfos,
    accessToken,
  }: Effect.Success<ReturnType<typeof offersBrowserLoginFirstAndUsesFirst>>) {
    yield* Effect.promise(() =>
      expect(
        openaiCodexOAuth.login({
          signal: neverAbortedSignal,
          prompt: (prompt) => {
            if (prompt.type !== "select")
              return Promise.reject(new Error("Text prompt should not be used"));
            selectPrompts.push(prompt);
            return Promise.resolve("device_code");
          },
          notify: (event) => {
            if (event.type === "auth_url") throw new Error("Browser login should not start");
            if (event.type === "device_code") {
              const { type: _, ...info } = event;
              deviceInfos.push(info);
            }
          },
        }),
      ).resolves.toMatchObject({
        type: "oauth",
        access: accessToken,
        refresh: "refresh-token",
        accountId: "account-456",
      }),
    );

    expect(selectPrompts).toEqual([
      {
        type: "select",
        message: "Select OpenAI Codex login method:",
        options: [
          { id: "browser", label: "Browser login (default)" },
          { id: "device_code", label: "Device code login (headless)" },
        ],
      },
    ]);
    expect(deviceInfos).toEqual([
      {
        userCode: "WXYZ-7890",
        verificationUri: "https://auth.openai.com/codex/device",
        intervalSeconds: 5,
        expiresInSeconds: 900,
      },
    ]);
  },
);

describe("OpenAI Codex OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("offers browser login first and uses the selected OpenAI Codex device code flow", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { selectPrompts, deviceInfos, accessToken } =
          yield* offersBrowserLoginFirstAndUsesFirst();
        return yield* offersBrowserLoginFirstAndUsesRest({
          selectPrompts,
          deviceInfos,
          accessToken,
        });
      }),
    ));
});

describe("OpenAI Codex OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("cancels when OpenAI Codex login method selection is cancelled", () =>
    expect(
      openaiCodexOAuth.login({
        signal: neverAbortedSignal,
        prompt: () => Promise.reject(new Error("Login cancelled")),
        notify: () => {},
      }),
    ).rejects.toThrow("Login cancelled"));
});

const cancelsTheOpenAICodexDeviceCodeFirst = () =>
  Effect.sync(() => {
    vi.useFakeTimers();
    const pollTimes: number[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, init?: RequestInit): Promise<Response> => {
        const url = getUrl(input);
        if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
          expect(JSON.parse(String(init?.body))).toEqual({
            client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
          });
          return Promise.resolve(
            jsonResponse({
              device_auth_id: "device-auth-id",
              user_code: "ABCD-1234",
              interval: "5",
            }),
          );
        }
        if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
          pollTimes.push(currentTimeMillis());
          return Promise.resolve(deviceAuthPendingResponse());
        }
        return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
      }),
    );
    return { pollTimes };
  });

const cancelsTheOpenAICodexDeviceCodeRest = Effect.fn("cancelsTheOpenAICodexDeviceCodeRest")(
  function* (
    controller: AbortController,
    { pollTimes }: Effect.Success<ReturnType<typeof cancelsTheOpenAICodexDeviceCodeFirst>>,
  ) {
    const credentialsPromise = loginOpenAICodexDeviceCodeForTest({
      onDeviceCode: () => {},
      signal: controller.signal,
    });
    const rejectionPromise = credentialsPromise.then(
      () => new Error("Expected login to fail"),
      (error: unknown) => error,
    );

    for (let i = 0; i < 5 && pollTimes.length === 0; i++) {
      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
    }
    expect(pollTimes).toHaveLength(1);

    controller.abort();
    const rejection = yield* Effect.promise(() => rejectionPromise);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe("Login cancelled");
  },
);

describe("OpenAI Codex OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("cancels the OpenAI Codex device code flow while waiting", () => {
    const controller = new AbortController();
    return Effect.runPromise(
      Effect.gen(function* () {
        const { pollTimes } = yield* cancelsTheOpenAICodexDeviceCodeFirst();
        return yield* cancelsTheOpenAICodexDeviceCodeRest(controller, { pollTimes });
      }),
    );
  });
});

describe("OpenAI Codex OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("times out the OpenAI Codex device code flow after 15 minutes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const pollTimes: number[] = [];

        vi.stubGlobal(
          "fetch",
          vi.fn((input: unknown, init?: RequestInit): Promise<Response> => {
            const url = getUrl(input);
            if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
              expect(JSON.parse(String(init?.body))).toEqual({
                client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
              });
              return Promise.resolve(
                jsonResponse({
                  device_auth_id: "device-auth-id",
                  user_code: "ABCD-1234",
                  interval: "60",
                }),
              );
            }
            if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
              pollTimes.push(currentTimeMillis());
              return Promise.resolve(deviceAuthPendingResponse());
            }
            return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
          }),
        );

        const credentialsPromise = loginOpenAICodexDeviceCodeForTest({
          onDeviceCode: () => {},
        });
        const rejectionPromise = credentialsPromise.then(
          () => new Error("Expected login to fail"),
          (error: unknown) => error,
        );

        for (let i = 0; i < 5 && pollTimes.length === 0; i++) {
          yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
        }
        expect(pollTimes).toHaveLength(1);

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(15 * 60 * 1000));
        const rejection = yield* Effect.promise(() => rejectionPromise);
        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toBe("Device flow timed out");
      }),
    ));
});

const treatsOpenAICodexDeviceAuth403First = () =>
  Effect.sync(() => {
    vi.useFakeTimers();
    const accessToken = createAccessToken("account-403-404");
    const pollTimes: number[] = [];
    const pollResponses = [
      jsonResponse({ error: "access_denied", error_description: "denied" }, 403),
      new Response("not ready", { status: 404, headers: { "Content-Type": "text/plain" } }),
      jsonResponse({
        authorization_code: "oauth-code",
        code_challenge: "device-code-challenge",
        code_verifier: "device-code-verifier",
      }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown): Promise<Response> => {
        const url = getUrl(input);
        if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
          return Promise.resolve(
            jsonResponse({
              device_auth_id: "device-auth-id",
              user_code: "ABCD-1234",
              interval: "1",
            }),
          );
        }
        if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
          pollTimes.push(currentTimeMillis());
          const response = pollResponses.shift();
          if (response === undefined) {
            return Promise.reject(new Error("Unexpected extra device auth poll"));
          }
          return Promise.resolve(response);
        }
        if (url === "https://auth.openai.com/oauth/token") {
          return Promise.resolve(
            jsonResponse({
              access_token: accessToken,
              refresh_token: "refresh-token",
              expires_in: 3600,
            }),
          );
        }
        return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
      }),
    );
    return { pollTimes, accessToken };
  });

const treatsOpenAICodexDeviceAuth403Rest = Effect.fn("treatsOpenAICodexDeviceAuth403Rest")(
  function* ({
    pollTimes,
    accessToken,
  }: Effect.Success<ReturnType<typeof treatsOpenAICodexDeviceAuth403First>>) {
    const credentialsPromise = loginOpenAICodexDeviceCodeForTest({
      onDeviceCode: () => {},
    });

    for (let i = 0; i < 5 && pollTimes.length === 0; i++) {
      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
    }
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1000));
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1000));

    yield* Effect.promise(() =>
      expect(credentialsPromise).resolves.toMatchObject({
        access: accessToken,
        refresh: "refresh-token",
        accountId: "account-403-404",
      }),
    );
    expect(pollTimes).toHaveLength(3);
  },
);

describe("OpenAI Codex OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("treats OpenAI Codex device auth 403 and 404 responses as pending", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { pollTimes, accessToken } = yield* treatsOpenAICodexDeviceAuth403First();
        return yield* treatsOpenAICodexDeviceAuth403Rest({ pollTimes, accessToken });
      }),
    ));
});

describe("OpenAI Codex OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("includes the response body in OpenAI Codex device auth poll failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn((input: unknown): Promise<Response> => {
            const url = getUrl(input);
            if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
              return Promise.resolve(
                jsonResponse({
                  device_auth_id: "device-auth-id",
                  user_code: "ABCD-1234",
                  interval: "5",
                }),
              );
            }
            if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
              return Promise.resolve(
                jsonResponse({ error: "server_error", error_description: "try again later" }, 500),
              );
            }
            return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
          }),
        );

        yield* Effect.promise(() =>
          expect(
            loginOpenAICodexDeviceCodeForTest({
              onDeviceCode: () => {},
            }),
          ).rejects.toThrow(
            'OpenAI Codex device auth failed with status 500: {"error":"server_error","error_description":"try again later"}',
          ),
        );
      }),
    ));
});

describe("OpenAI Codex OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("does not write token refresh failures to stderr", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.stubGlobal(
          "fetch",
          vi.fn((): Promise<Response> =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  error: {
                    message: "Could not validate your token. Please try signing in again.",
                    type: "invalid_request_error",
                  },
                }),
                {
                  status: 401,
                  statusText: "Unauthorized",
                  headers: { "Content-Type": "application/json" },
                },
              ),
            ),
          ),
        );

        yield* Effect.promise(() =>
          expect(
            openaiCodexOAuth.refresh(
              {
                type: "oauth",
                access: "invalid-access-token",
                refresh: "invalid-refresh-token",
                expires: 0,
              },
              neverAbortedSignal,
            ),
          ).rejects.toThrow(
            /OpenAI Codex token refresh failed \(401\).*Could not validate your token/u,
          ),
        );
        expect(consoleError).not.toHaveBeenCalled();
      }),
    ));
});

describe("OpenAI Codex OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("uses the app's agent name as the browser login originator", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(() =>
            Promise.resolve(
              jsonResponse({
                access_token: createAccessToken("acct"),
                refresh_token: "refresh",
                expires_in: 3600,
              }),
            ),
          ),
        );

        let authUrl = "";
        yield* Effect.promise(() =>
          openaiCodexOAuth.login(
            {
              signal: neverAbortedSignal,
              notify: (event) => {
                if (event.type === "auth_url") authUrl = event.url;
              },
              prompt: (prompt) => {
                if (prompt.type === "select") return Promise.resolve("browser");
                if (prompt.type !== "manual_code")
                  return Promise.reject(new Error(`Unexpected prompt: ${prompt.type}`));
                const state = new URL(authUrl).searchParams.get("state");
                return Promise.resolve(
                  `http://localhost:1455/auth/callback?code=pasted-code&state=${state}`,
                );
              },
            },
            { agentName: "my-app" },
          ),
        );

        expect(new URL(authUrl).searchParams.get("originator")).toBe("my-app");
      }),
    ));
});

describe("OpenAI Codex OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("falls back to the pasted redirect URL when the fixed callback port is taken", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.once("error", () => resolve());
      blocker.listen(1455, "127.0.0.1", () => resolve());
    });
    try {
      let exchangeBody: URLSearchParams | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn((input: unknown, init?: RequestInit) => {
          expect(getUrl(input)).toBe("https://auth.openai.com/oauth/token");
          exchangeBody = new URLSearchParams(String(init?.body));
          return Promise.resolve(
            jsonResponse({
              access_token: createAccessToken("acct"),
              refresh_token: "refresh",
              expires_in: 3600,
            }),
          );
        }),
      );

      let authUrl = "";
      const credential = await openaiCodexOAuth.login({
        signal: neverAbortedSignal,
        notify: (event) => {
          if (event.type === "auth_url") authUrl = event.url;
        },
        prompt: (prompt) => {
          if (prompt.type === "select") return Promise.resolve("browser");
          if (prompt.type !== "manual_code")
            return Promise.reject(new Error(`Unexpected prompt: ${prompt.type}`));
          const state = new URL(authUrl).searchParams.get("state");
          return Promise.resolve(
            `http://localhost:1455/auth/callback?code=pasted-code&state=${state}`,
          );
        },
      });

      expect(credential["accountId"]).toBe("acct");
      expect(exchangeBody?.get("code")).toBe("pasted-code");
      expect(exchangeBody?.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
    } finally {
      blocker.close();
    }
  });
});
