import { DateTime, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { xaiOAuth } from "../src/auth/oauth/xai.ts";
import type { AuthEvent, OAuthCredential } from "../src/auth/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

const neverAbortedSignal = new AbortController().signal;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  throw new Error(`Unsupported request input: ${String(input)}`);
}

function requestForm(init: RequestInit | undefined): URLSearchParams {
  return new URLSearchParams(String(init?.body));
}

function deviceCodeResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    device_code: "device-code",
    user_code: "ABCD-1234",
    verification_uri: "https://accounts.x.ai/oauth2/device",
    expires_in: 900,
    interval: 5,
    ...overrides,
  };
}

function tokenResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 21_600,
    token_type: "Bearer",
    ...overrides,
  };
}

type DeviceCodeInfo = Omit<Extract<AuthEvent, { type: "device_code" }>, "type">;

function loginXaiForTest(options: {
  onDeviceCode: (info: DeviceCodeInfo) => void;
  signal?: AbortSignal;
}): Promise<OAuthCredential> {
  return xaiOAuth.login({
    signal: options.signal ?? neverAbortedSignal,
    prompt: () => {
      throw new Error("Unexpected prompt");
    },
    notify: (event) => {
      if (event.type === "device_code") {
        const { type: _, ...info } = event;
        options.onDeviceCode(info);
      }
    },
  });
}

function refreshXaiForTest(refreshToken: string): Promise<OAuthCredential> {
  return xaiOAuth.refresh(
    { type: "oauth", access: "old-access", refresh: refreshToken, expires: 0 },
    neverAbortedSignal,
  );
}

describe("xAI OAuth device flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses the device grant, delays polling, and handles pending and slow_down", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const startTime = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-07-09T20:00:00Z"));
        vi.setSystemTime(startTime);
        const pollTimes: number[] = [];
        const tokenReplies = [
          jsonResponse({ error: "authorization_pending" }, 400),
          jsonResponse({ error: "slow_down", interval: 10 }, 400),
          jsonResponse(tokenResponse()),
        ];

        const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
          const url = requestUrl(input);

          if (url === "https://auth.x.ai/oauth2/device/code") {
            const form = requestForm(init);
            expect(form.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828");
            expect(form.get("scope")).toBe(
              "openid profile email offline_access grok-cli:access api:access",
            );
            expect(form.get("referrer")).toBe("pi");
            return Promise.resolve(jsonResponse(deviceCodeResponse()));
          }

          if (url === "https://auth.x.ai/oauth2/token") {
            pollTimes.push(currentTimeMillis());
            const form = requestForm(init);
            expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
            expect(form.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828");
            expect(form.get("device_code")).toBe("device-code");
            const reply = tokenReplies.shift();
            if (reply === undefined) return Promise.reject(new Error("Unexpected token poll"));
            return Promise.resolve(reply);
          }

          return Promise.reject(new Error(`Unexpected request: ${url}`));
        });
        vi.stubGlobal("fetch", fetchMock);

        const deviceCodes: DeviceCodeInfo[] = [];
        const loginPromise = loginXaiForTest({ onDeviceCode: (info) => deviceCodes.push(info) });

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
        expect(deviceCodes).toEqual([
          {
            userCode: "ABCD-1234",
            verificationUri: "https://accounts.x.ai/oauth2/device",
            intervalSeconds: 5,
            expiresInSeconds: 900,
          },
        ]);
        expect(pollTimes).toEqual([]);

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(5000));
        expect(pollTimes).toEqual([startTime + 5000]);

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(5000));
        expect(pollTimes).toEqual([startTime + 5000, startTime + 10_000]);

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(10_000));
        const credentials = yield* Effect.promise(() => loginPromise);
        expect(pollTimes).toEqual([startTime + 5000, startTime + 10_000, startTime + 20_000]);
        expect(credentials).toEqual({
          type: "oauth",
          access: "access-token",
          refresh: "refresh-token",
          expires: startTime + 20_000 + 21_600_000 - 300_000,
        });
      }),
    ));

  it("falls back to the default poll interval when the response reports interval 0", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const startTime = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-07-09T20:00:00Z"));
        vi.setSystemTime(startTime);
        const pollTimes: number[] = [];
        vi.stubGlobal(
          "fetch",
          vi.fn((input: unknown) => {
            if (requestUrl(input) === "https://auth.x.ai/oauth2/device/code") {
              return Promise.resolve(jsonResponse(deviceCodeResponse({ interval: 0 })));
            }
            pollTimes.push(currentTimeMillis());
            return Promise.resolve(jsonResponse(tokenResponse()));
          }),
        );

        const loginPromise = loginXaiForTest({ onDeviceCode: () => {} });
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(5000));
        yield* Effect.promise(() => loginPromise);
        expect(pollTimes).toEqual([startTime + 5000]);
      }),
    ));

  it("prefers verification_uri_complete when the server provides it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        vi.stubGlobal(
          "fetch",
          vi.fn((input: unknown) => {
            if (requestUrl(input) === "https://auth.x.ai/oauth2/device/code") {
              return Promise.resolve(
                jsonResponse(
                  deviceCodeResponse({
                    verification_uri_complete:
                      "https://accounts.x.ai/oauth2/device?user_code=ABCD-1234",
                  }),
                ),
              );
            }
            return Promise.resolve(jsonResponse(tokenResponse()));
          }),
        );

        const deviceCodes: DeviceCodeInfo[] = [];
        const loginPromise = loginXaiForTest({ onDeviceCode: (info) => deviceCodes.push(info) });
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(5000));
        yield* Effect.promise(() => loginPromise);
        expect(deviceCodes).toEqual([
          {
            userCode: "ABCD-1234",
            verificationUri: "https://accounts.x.ai/oauth2/device?user_code=ABCD-1234",
            intervalSeconds: 5,
            expiresInSeconds: 900,
          },
        ]);
      }),
    ));

  it("rejects a non-https verification_uri_complete", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(() =>
            Promise.resolve(
              jsonResponse(
                deviceCodeResponse({
                  verification_uri_complete:
                    "http://accounts.x.ai/oauth2/device?user_code=ABCD-1234",
                }),
              ),
            ),
          ),
        );

        yield* Effect.promise(() =>
          expect(loginXaiForTest({ onDeviceCode: () => {} })).rejects.toThrow(
            "Untrusted verification URI",
          ),
        );
      }),
    ));

  it.each(["http://accounts.x.ai/oauth2/device", "file:///etc/passwd", "not a url"])(
    "rejects a non-https verification URI: %s",
    (verificationUri) =>
      Effect.runPromise(
        Effect.gen(function* () {
          vi.stubGlobal(
            "fetch",
            vi.fn(() =>
              Promise.resolve(
                jsonResponse(deviceCodeResponse({ verification_uri: verificationUri })),
              ),
            ),
          );

          yield* Effect.promise(() =>
            expect(loginXaiForTest({ onDeviceCode: () => {} })).rejects.toThrow(
              "Untrusted verification URI",
            ),
          );
        }),
      ),
  );

  it.each(["access_denied", "authorization_denied"])(
    "fails when device authorization is denied: %s",
    (error) =>
      Effect.runPromise(
        Effect.gen(function* () {
          vi.useFakeTimers();
          let requestCount = 0;
          vi.stubGlobal(
            "fetch",
            vi.fn(() => {
              requestCount += 1;
              return Promise.resolve(
                requestCount === 1
                  ? jsonResponse(deviceCodeResponse({ interval: 1 }))
                  : jsonResponse({ error }, 400),
              );
            }),
          );

          const loginPromise = loginXaiForTest({ onDeviceCode: () => {} });
          const assertion = expect(loginPromise).rejects.toThrow(
            "xAI device authorization was denied",
          );
          yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1000));
          yield* Effect.promise(() => assertion);
        }),
      ),
  );

  it("cancels while waiting for the first token poll", () => {
    const controller = new AbortController();
    return Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(deviceCodeResponse())));
        vi.stubGlobal("fetch", fetchMock);

        const loginPromise = loginXaiForTest({
          onDeviceCode: () => controller.abort(),
          signal: controller.signal,
        });

        yield* Effect.promise(() => expect(loginPromise).rejects.toThrow("Login cancelled"));
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }),
    );
  });

  it("refreshes tokens and preserves an unrotated refresh token", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let requestCount = 0;
        const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
          expect(requestUrl(input)).toBe("https://auth.x.ai/oauth2/token");
          const form = requestForm(init);
          expect(form.get("grant_type")).toBe("refresh_token");
          expect(form.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828");
          requestCount += 1;
          if (requestCount === 1) {
            expect(form.get("refresh_token")).toBe("old-refresh");
            return Promise.resolve(
              jsonResponse(
                tokenResponse({ access_token: "new-access", refresh_token: "new-refresh" }),
              ),
            );
          }
          expect(form.get("refresh_token")).toBe("keep-refresh");
          return Promise.resolve(
            jsonResponse(tokenResponse({ access_token: "newer-access", refresh_token: undefined })),
          );
        });
        vi.stubGlobal("fetch", fetchMock);

        const rotated = yield* Effect.promise(() => refreshXaiForTest("old-refresh"));
        const preserved = yield* Effect.promise(() => refreshXaiForTest("keep-refresh"));
        expect(rotated.type).toBe("oauth");
        expect(rotated.refresh).toBe("new-refresh");
        expect(rotated.access).toBe("new-access");
        expect(preserved.refresh).toBe("keep-refresh");
        expect(preserved.access).toBe("newer-access");
        expect(xaiOAuth.name).toBe("xAI (Grok/X subscription)");
        yield* Effect.promise(() =>
          expect(xaiOAuth.toAuth(preserved)).resolves.toEqual({ apiKey: "newer-access" }),
        );
      }),
    ));

  it("assumes a one-hour lifetime when expires_in is missing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const startTime = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-07-09T20:00:00Z"));
        vi.setSystemTime(startTime);
        vi.stubGlobal(
          "fetch",
          vi.fn(() => Promise.resolve(jsonResponse(tokenResponse({ expires_in: undefined })))),
        );

        const credentials = yield* Effect.promise(() => refreshXaiForTest("old-refresh"));
        expect(credentials.expires).toBe(startTime + 3_600_000 - 300_000);
      }),
    ));

  it("rejects token responses with missing fields", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(() => Promise.resolve(jsonResponse(tokenResponse({ access_token: undefined })))),
        );

        yield* Effect.promise(() =>
          expect(refreshXaiForTest("old-refresh")).rejects.toThrow(
            "Invalid xAI OAuth response field: access_token",
          ),
        );
      }),
    ));

  it("surfaces the upstream error code and description on refresh failure", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(() =>
            Promise.resolve(
              jsonResponse(
                { error: "invalid_grant", error_description: "refresh token revoked" },
                400,
              ),
            ),
          ),
        );

        yield* Effect.promise(() =>
          expect(refreshXaiForTest("old-refresh")).rejects.toThrow(
            "xAI OAuth token refresh failed (HTTP 400): invalid_grant: refresh token revoked",
          ),
        );
      }),
    ));
});
