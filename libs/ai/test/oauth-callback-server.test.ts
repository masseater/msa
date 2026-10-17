import { createServer, type Server } from "node:http";

import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  startOAuthCallbackServer,
  waitForCallbackOrManualInput,
} from "../src/auth/oauth/callback-server.ts";
import type { AuthPrompt, ProviderAuthInteraction } from "../src/auth/types.ts";

const nativeFetch = globalThis.fetch;
const requestCallback = (input: string | URL, init?: RequestInit) => nativeFetch(input, init);

function callbackUrl(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

const page = Effect.fn("page")(function* (response: Response) {
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: yield* Effect.promise(() => response.text()),
  };
});

function interaction(
  prompt: (prompt: AuthPrompt) => Promise<string>,
  signal?: AbortSignal,
): ProviderAuthInteraction {
  return { signal: signal ?? new AbortController().signal, notify: () => {}, prompt };
}

function pendingPrompt(
  onPrompt?: (prompt: AuthPrompt) => void,
): (prompt: AuthPrompt) => Promise<string> {
  return (prompt) => {
    onPrompt?.(prompt);
    return new Promise((_, reject) => {
      prompt.signal?.addEventListener("abort", () => reject(new Error("prompt aborted")), {
        once: true,
      });
    });
  };
}

describe("OAuth callback server", () => {
  const servers: { close(): void }[] = [];
  const start = <T>(options: Partial<Parameters<typeof startOAuthCallbackServer<T>>[0]> = {}) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() =>
          startOAuthCallbackServer<T>({
            providerName: "Example",
            host: "127.0.0.1",
            port: 0,
            path: "/callback",
            state: "expected-state",
            complete: (code) => Promise.resolve(`completed:${code}` as T),
            ...options,
          }),
        );
        servers.push(server);
        return server;
      }),
    );

  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  it("ignores stray requests and resolves with the completed code", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() => start<string>());
        expect(server.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/u);

        const wrongPath = yield* page(
          yield* Effect.promise(() => requestCallback(new URL("/other", server.redirectUri))),
        );
        expect(wrongPath.status).toBe(404);
        const wrongState = yield* page(
          yield* Effect.promise(() =>
            requestCallback(callbackUrl(server.redirectUri, { code: "c", state: "other" })),
          ),
        );
        expect(wrongState).toMatchObject({ status: 400, contentType: "text/html; charset=utf-8" });
        expect(wrongState.body).toContain("State mismatch.");
        const post = yield* Effect.promise(() =>
          requestCallback(callbackUrl(server.redirectUri, { code: "c", state: "expected-state" }), {
            method: "POST",
          }),
        );
        expect(post.status).toBe(404);
        const missingCode = yield* page(
          yield* Effect.promise(() =>
            requestCallback(callbackUrl(server.redirectUri, { state: "expected-state" })),
          ),
        );
        expect(missingCode.status).toBe(400);

        const success = yield* page(
          yield* Effect.promise(() =>
            requestCallback(
              callbackUrl(server.redirectUri, { code: "the-code", state: "expected-state" }),
            ),
          ),
        );
        expect(success).toMatchObject({ status: 200, contentType: "text/html; charset=utf-8" });
        expect(success.body).toContain("Authentication successful");
        expect(success.body).toContain("Signed in to Example.");
        expect(success.body).toContain('fill="#F09082"');
        expect(success.body).toContain('fill="#4D9ABF"');
        expect(success.body).toContain('fill="#F1BE58"');
        yield* Effect.promise(() => expect(server.wait()).resolves.toBe("completed:the-code"));
      }),
    ));

  it("uses the redirect host and skips the state check when none is expected", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() =>
          start<string>({ redirectHost: "localhost", state: undefined }),
        );
        expect(server.redirectUri).toMatch(/^http:\/\/localhost:\d+\/callback$/u);
        const response = yield* Effect.promise(() =>
          requestCallback(callbackUrl(server.redirectUri, { code: "no-state" })),
        );
        expect(response.status).toBe(200);
        yield* Effect.promise(() => expect(server.wait()).resolves.toBe("completed:no-state"));
      }),
    ));

  it("shows completion failures on the page and rejects the wait", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() =>
          start<string>({
            complete: () => {
              return Promise.reject(new Error("token exchange failed"));
            },
          }),
        );
        const failure = yield* page(
          yield* Effect.promise(() =>
            requestCallback(
              callbackUrl(server.redirectUri, { code: "c", state: "expected-state" }),
            ),
          ),
        );
        expect(failure.status).toBe(502);
        expect(failure.body).toContain("Example sign-in failed.");
        expect(failure.body).toContain("token exchange failed");
        yield* Effect.promise(() => expect(server.wait()).rejects.toThrow("token exchange failed"));
      }),
    ));

  it("rejects the wait when the provider redirects with an error", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() => start<string>());
        const failure = yield* page(
          yield* Effect.promise(() =>
            requestCallback(
              callbackUrl(server.redirectUri, {
                error: "access_denied",
                error_description: "User denied access",
                state: "expected-state",
              }),
            ),
          ),
        );
        expect(failure.status).toBe(400);
        expect(failure.body).toContain("User denied access");
        yield* Effect.promise(() =>
          expect(server.wait()).rejects.toThrow("Example authorization failed: User denied access"),
        );
      }),
    ));

  it("completes only the first callback", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let finishExchange: ((value: string) => void) | undefined;
        const server = yield* Effect.promise(() =>
          start<string>({
            complete: () =>
              new Promise<string>((resolve) => {
                finishExchange = resolve;
              }),
          }),
        );
        const url = callbackUrl(server.redirectUri, { code: "c", state: "expected-state" });
        const first = requestCallback(url);
        yield* Effect.promise(() => vi.waitFor(() => expect(finishExchange).toBeDefined()));
        const second = yield* Effect.promise(() => requestCallback(url));
        expect(second.status).toBe(409);
        server.cancel();
        finishExchange?.("done");
        expect((yield* Effect.promise(() => first)).status).toBe(200);
        yield* Effect.promise(() => expect(server.wait()).resolves.toBe("done"));
      }),
    ));

  it("resolves with undefined after cancel", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() => start<string>());
        server.cancel();
        yield* Effect.promise(() => expect(server.wait()).resolves.toBeUndefined());
        const late = yield* Effect.promise(() =>
          requestCallback(callbackUrl(server.redirectUri, { code: "c", state: "expected-state" })),
        );
        expect(late.status).toBe(409);
      }),
    ));

  it("rejects the wait on abort and on timeout", () => {
    const controller = new AbortController();
    return Effect.runPromise(
      Effect.gen(function* () {
        const aborted = yield* Effect.promise(() => start<string>({ signal: controller.signal }));
        controller.abort();
        yield* Effect.promise(() => expect(aborted.wait()).rejects.toThrow("Login cancelled"));

        const timedOut = yield* Effect.promise(() => start<string>({ timeoutMs: 10 }));
        yield* Effect.promise(() =>
          expect(timedOut.wait()).rejects.toThrow("Example sign-in timed out"),
        );

        const alreadyAbortedSignal = AbortSignal.abort();
        yield* Effect.promise(() =>
          expect(start<string>({ signal: alreadyAbortedSignal })).rejects.toThrow(
            "Login cancelled",
          ),
        );
      }),
    );
  });

  it("fails instead of picking another port when the requested port is taken", async () => {
    const blocker: Server = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = blocker.address();
      if (address === null || address === "" || typeof address === "string")
        throw new Error("blocker did not bind to TCP");
      await expect(start<string>({ port: address.port })).rejects.toMatchObject({
        code: "EADDRINUSE",
      });
    } finally {
      blocker.close();
    }
  });
});

describe("waitForCallbackOrManualInput", () => {
  it("returns the browser callback and aborts the manual prompt", async () => {
    let manualSignal: AbortSignal | undefined;
    const server = await startOAuthCallbackServer({
      providerName: "Example",
      host: "127.0.0.1",
      port: 0,
      path: "/callback",
      complete: (code) => Promise.resolve(code),
    });
    try {
      const result = waitForCallbackOrManualInput(
        interaction(
          pendingPrompt((prompt) => {
            manualSignal = prompt.signal;
          }),
        ),
        server,
        { message: "paste", placeholder: server.redirectUri },
      );
      await requestCallback(callbackUrl(server.redirectUri, { code: "from-browser" }));
      await expect(result).resolves.toEqual({ type: "callback", value: "from-browser" });
      expect(manualSignal?.aborted).toBe(true);
    } finally {
      server.close();
    }
  });

  it("returns pasted input and stops waiting for the browser", async () => {
    const server = await startOAuthCallbackServer({
      providerName: "Example",
      host: "127.0.0.1",
      port: 0,
      path: "/callback",
      complete: (code) => Promise.resolve(code),
    });
    try {
      const result = await waitForCallbackOrManualInput(
        interaction(() => Promise.resolve("pasted")),
        server,
        {
          message: "paste",
          placeholder: server.redirectUri,
        },
      );
      expect(result).toEqual({ type: "manual", input: "pasted" });
    } finally {
      server.close();
    }
  });

  it("uses only the manual prompt without a callback server", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          waitForCallbackOrManualInput(
            interaction(() => Promise.resolve("pasted")),
            undefined,
            {
              message: "paste",
              placeholder: "http://localhost/callback",
            },
          ),
        );
        expect(result).toEqual({ type: "manual", input: "pasted" });
      }),
    ));

  it("propagates manual prompt failures", async () => {
    const server = await startOAuthCallbackServer({
      providerName: "Example",
      host: "127.0.0.1",
      port: 0,
      path: "/callback",
      complete: (code) => Promise.resolve(code),
    });
    try {
      const result = waitForCallbackOrManualInput(
        interaction(() => {
          return Promise.reject(new Error("prompt cancelled"));
        }),
        server,
        { message: "paste", placeholder: server.redirectUri },
      );
      await expect(result).rejects.toThrow("prompt cancelled");
    } finally {
      server.close();
    }
  });
});
