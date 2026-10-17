import { DateTime, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { metaOAuth } from "../src/auth/oauth/meta.ts";
import type { ProviderAuthInteraction } from "../src/auth/types.ts";

const CLIENT_ID = "1031625952748946";
const DEVICE_AUTHORIZATION_URL = "https://auth.meta.com/oidc/device/authorization/";
const DEVICE_TOKEN_URL = "https://auth.meta.com/oidc/device/token/";
const MINT_URL = "https://api.meta.ai/muse-code/key";
const DAY_MS = 24 * 60 * 60 * 1000;

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

function createInteraction(events: Array<Record<string, unknown>>): ProviderAuthInteraction {
  return {
    signal: new AbortController().signal,
    prompt: () => {
      return Promise.reject(new Error("Meta login should not prompt"));
    },
    notify: (event) => events.push(event),
  };
}

describe("Meta OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("logs in with the device flow and mints a Model API key", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const startTime = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-09-03T00:00:00Z"));
        vi.setSystemTime(startTime);

        const events: Array<Record<string, unknown>> = [];
        const pollResponses = [
          jsonResponse({ error: "authorization_pending" }, 400),
          jsonResponse({ access_token: "identity-token", token_type: "Bearer" }),
        ];

        vi.stubGlobal(
          "fetch",
          vi.fn((input: unknown, init?: RequestInit): Promise<Response> => {
            const url = getUrl(input);
            if (url === DEVICE_AUTHORIZATION_URL) {
              expect(init?.method).toBe("POST");
              expect(new URLSearchParams(String(init?.body)).get("client_id")).toBe(CLIENT_ID);
              return Promise.resolve(
                jsonResponse({
                  device_code: "device-code-123",
                  user_code: "ABCD-1234",
                  verification_uri: "https://auth.meta.com/oauth/device/",
                  verification_uri_complete: "https://auth.meta.com/oauth/device/?code=ABCD-1234",
                  interval: 5,
                  expires_in: 600,
                }),
              );
            }
            if (url === DEVICE_TOKEN_URL) {
              const params = new URLSearchParams(String(init?.body));
              expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
              expect(params.get("client_id")).toBe(CLIENT_ID);
              expect(params.get("device_code")).toBe("device-code-123");
              const response = pollResponses.shift();
              if (response === undefined)
                return Promise.reject(new Error("Unexpected extra token poll"));
              return Promise.resolve(response);
            }
            if (url === MINT_URL) {
              expect(init?.method).toBe("POST");
              expect(init?.headers).toMatchObject({ authorization: "Bearer identity-token" });
              return Promise.resolve(jsonResponse({ api_key: "LLM|minted-key" }));
            }
            return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
          }),
        );

        const credentialPromise = metaOAuth.login(createInteraction(events));
        for (let i = 0; i < 5 && events.length === 0; i++) {
          yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
        }
        expect(events[0]).toEqual({
          type: "device_code",
          userCode: "ABCD-1234",
          verificationUri: "https://auth.meta.com/oauth/device/?code=ABCD-1234",
          intervalSeconds: 5,
          expiresInSeconds: 600,
        });

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(10000));
        yield* Effect.promise(() =>
          expect(credentialPromise).resolves.toEqual({
            type: "oauth",
            refresh: "identity-token",
            access: "LLM|minted-key",
            expires: startTime + 10000 + DAY_MS,
          }),
        );
      }),
    ));

  it("re-mints the API key from the stored identity token on refresh", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const now = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-09-03T12:00:00Z"));
        vi.setSystemTime(now);
        vi.stubGlobal(
          "fetch",
          vi.fn((input: unknown, init?: RequestInit): Promise<Response> => {
            expect(getUrl(input)).toBe(MINT_URL);
            expect(init?.headers).toMatchObject({ authorization: "Bearer identity-token" });
            return Promise.resolve(jsonResponse({ api_key: "LLM|fresh-key" }));
          }),
        );

        yield* Effect.promise(() =>
          expect(
            metaOAuth.refresh(
              { type: "oauth", refresh: "identity-token", access: "LLM|old-key", expires: 1 },
              new AbortController().signal,
            ),
          ).resolves.toEqual({
            type: "oauth",
            refresh: "identity-token",
            access: "LLM|fresh-key",
            expires: now + DAY_MS,
          }),
        );
      }),
    ));

  it("reports the setup URL when Meta issues no key", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(() =>
            Promise.resolve(
              jsonResponse({ require_payment: true, action_url: "https://dev.meta.ai/billing" }),
            ),
          ),
        );
        yield* Effect.promise(() =>
          expect(
            metaOAuth.refresh(
              { type: "oauth", refresh: "identity-token", access: "", expires: 1 },
              new AbortController().signal,
            ),
          ).rejects.toThrow("Complete setup at https://dev.meta.ai/billing"),
        );
      }),
    ));

  it("uses the minted key as the request api key", () =>
    expect(
      metaOAuth.toAuth({ type: "oauth", refresh: "identity-token", access: "LLM|key", expires: 1 }),
    ).resolves.toEqual({ apiKey: "LLM|key" }));
});
