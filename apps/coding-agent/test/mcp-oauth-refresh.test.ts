import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { type OAuthChallenge, OAuthIssuerMismatchError } from "@msa/mcp/oauth";
import { awaited, runTest, readDirectory, joinPath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { InMemoryAuthStorageBackend } from "../src/core/auth-storage.ts";
import {
  createMcpAuthProvider,
  McpOAuthCredentialStore,
  type McpOAuthSettings,
  type McpSignInPrompt,
  signInMcpServer,
} from "../src/extensions/mcp/oauth.ts";
import { startOAuthMcpServer } from "./suite/mcp-oauth-server.ts";

describe("MCP OAuth refresh", () => {
  const cleanups: (() => Promise<void> | void)[] = [];

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        while (cleanups.length > 0) yield* awaited(cleanups.pop()?.());
      }),
    ),
  );

  function signedIn() {
    return runTest(
      Effect.gen(function* () {
        const server = yield* awaited(startOAuthMcpServer());
        cleanups.push(server.close);
        const lockDir = mkdtempSync(joinPath(tmpdir(), "msa-mcp-refresh-"));
        cleanups.push(() => rmSync(lockDir, { recursive: true, force: true }));

        const backend = new InMemoryAuthStorageBackend();
        const process = () => {
          const store = new McpOAuthCredentialStore(backend, lockDir).forServer("test", server.url);
          const provider = createMcpAuthProvider({
            serverUrl: server.url,
            store,
            settings: () => ({}),
            onChallenge: () => {},
          });
          return { store, provider };
        };
        yield* awaited(
          signInMcpServer({
            serverUrl: server.url,
            store: process().store,
            settings: {},
            prompt: {
              showAuthorizationUrl: (url) => void fetch(url),
              promptForRedirectUrl: (signal) =>
                new Promise((resolve) =>
                  signal.addEventListener("abort", () => resolve(undefined), { once: true }),
                ),
            },
          }),
        );
        return yield* awaited({ server, lockDir, process });
      }),
    );
  }

  it("refreshes once when several processes find the same token rejected", () =>
    runTest(
      Effect.gen(function* () {
        const { server, lockDir, process } = yield* awaited(signedIn());
        server.expireAccessTokens();
        const processes = [process(), process(), process()];

        yield* awaited(
          Promise.all(
            processes.map(({ provider }) =>
              provider.onUnauthorized?.({
                response: new Response(null, { status: 401 }),
                serverUrl: new URL(server.url),
                fetch: globalThis.fetch,
                token: "access-1",
              }),
            ),
          ),
        );

        expect(server.log.filter((entry) => entry === "token refresh")).toHaveLength(1);
        for (const { provider } of processes)
          expect(yield* awaited(provider.token())).toBe("access-2");

        expect(yield* readDirectory(lockDir)).toEqual([]);
      }),
    ));

  it("waits for a running refresh to save the new tokens", () =>
    runTest(
      Effect.gen(function* () {
        const { server, process } = yield* awaited(signedIn());
        server.expireAccessTokens();
        const { store, provider } = process();

        const refresh = provider.onUnauthorized?.({
          response: new Response(null, { status: 401 }),
          serverUrl: new URL(server.url),
          fetch: globalThis.fetch,
          token: "access-1",
        });
        yield* awaited(provider.settled());
        expect((yield* awaited(store.load()))?.tokens?.access_token).toBe("access-2");
        yield* awaited(refresh);
      }),
    ));
});

describe("MCP OAuth sign-in", () => {
  function signIn(
    options: { iss?: string },
    settings: (serverUrl: string) => McpOAuthSettings = () => ({}),
  ) {
    return runTest(
      Effect.gen(function* () {
        const server = yield* awaited(startOAuthMcpServer(options));
        try {
          yield* awaited(
            signInMcpServer({
              serverUrl: server.url,
              store: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()).forServer(
                "test",
                server.url,
              ),
              settings: settings(server.url),
              prompt: {
                showAuthorizationUrl: (url) => void fetch(url),
                promptForRedirectUrl: (signal) =>
                  new Promise((resolve) =>
                    signal.addEventListener("abort", () => resolve(undefined), { once: true }),
                  ),
              },
            }),
          );
        } finally {
          yield* awaited(server.close());
        }
      }),
    );
  }

  it("rejects an authorization response from another issuer", () =>
    runTest(
      awaited(
        expect(signIn({ iss: "https://attacker.example" })).rejects.toBeInstanceOf(
          OAuthIssuerMismatchError,
        ),
      ),
    ));

  it("keeps the granted scope when the server asks for more", () =>
    runTest(
      Effect.gen(function* () {
        const server = yield* awaited(startOAuthMcpServer());
        try {
          const store = new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()).forServer(
            "test",
            server.url,
          );
          const opened: URL[] = [];
          const signInWith = (challenge: OAuthChallenge) =>
            signInMcpServer({
              serverUrl: server.url,
              store,
              settings: {},
              challenge,
              prompt: {
                showAuthorizationUrl: (url) => {
                  opened.push(url);
                  void fetch(url);
                },
                promptForRedirectUrl: (signal) =>
                  new Promise((resolve) =>
                    signal.addEventListener("abort", () => resolve(undefined), { once: true }),
                  ),
              },
            });

          yield* awaited(signInWith({ scope: "issues:read" }));

          expect((yield* awaited(store.load()))?.tokens?.scope).toBe("issues:read");

          yield* awaited(signInWith({ error: "insufficient_scope", scope: "issues:write" }));
          expect(opened.map((url) => url.searchParams.get("scope"))).toEqual([
            "issues:read",
            "issues:read issues:write",
          ]);
          expect((yield* awaited(store.load()))?.tokens?.scope).toBe("issues:read issues:write");
        } finally {
          yield* awaited(server.close());
        }
      }),
    ));

  it("uses the configured authorization server metadata URL", () =>
    runTest(
      Effect.gen(function* () {
        const settings = (serverUrl: string) => ({
          authServerMetadataUrl: new URL("/missing", serverUrl),
        });
        yield* awaited(
          expect(signIn({}, settings)).rejects.toThrow(
            "HTTP 404 loading authorization server metadata",
          ),
        );
      }),
    ));
});

describe("MCP OAuth client ID metadata documents", () => {
  const cleanups: (() => Promise<void>)[] = [];
  const cimd: McpOAuthSettings = { clientRegistration: "cimd" };

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        while (cleanups.length > 0) yield* awaited(cleanups.pop()?.());
      }),
    ),
  );

  function startServer(options: { issParameter?: boolean; cimd?: boolean; redirectPath?: string }) {
    return runTest(
      Effect.gen(function* () {
        const server = yield* awaited(startOAuthMcpServer(options));
        cleanups.push(server.close);
        const store = new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()).forServer(
          "test",
          server.url,
        );
        const browser: McpSignInPrompt = {
          showAuthorizationUrl: (url) => void fetch(url),
          promptForRedirectUrl: (signal) =>
            new Promise((resolve) =>
              signal.addEventListener("abort", () => resolve(undefined), { once: true }),
            ),
        };
        const signIn = (settings: McpOAuthSettings, prompt = browser) =>
          signInMcpServer({ serverUrl: server.url, store, settings, prompt });
        return yield* awaited({ server, store, signIn });
      }),
    );
  }

  it("registers dynamically by default, even when the server supports documents", () =>
    runTest(
      Effect.gen(function* () {
        const { server, signIn } = yield* awaited(startServer({ cimd: true, issParameter: true }));
        yield* awaited(signIn({}));
        expect(server.registrations).toHaveLength(1);
        expect(server.authorizations[0]?.get("client_id")).toBe("client-1");
      }),
    ));

  it("uses msa's document when authorization responses name their issuer", () =>
    runTest(
      Effect.gen(function* () {
        const { server, store, signIn } = yield* awaited(
          startServer({ cimd: true, issParameter: true }),
        );
        yield* awaited(signIn(cimd));
        const [authorization] = server.authorizations;
        expect(authorization?.get("client_id")).toBe("https://pi.dev/oauth/client.json");
        const redirect = new URL(authorization?.get("redirect_uri") ?? "");
        expect(`${redirect.hostname}${redirect.pathname}`).toBe("127.0.0.1/callback");
        expect(redirect.port).not.toBe("");
        expect(server.registrations).toEqual([]);
        expect(server.tokenRequests[0]?.get("client_id")).toBe("https://pi.dev/oauth/client.json");
        expect(server.tokenRequests[0]?.get("redirect_uri")).toBe(redirect.href);

        expect((yield* awaited(store.load()))?.clientInformation).toBeUndefined();
        yield* awaited(signIn(cimd));
        expect(server.authorizations).toHaveLength(1);
        expect(server.tokenRequests[1]?.get("grant_type")).toBe("refresh_token");
        expect(server.tokenRequests[1]?.get("client_id")).toBe("https://pi.dev/oauth/client.json");
      }),
    ));

  it("uses a document and callback path specific to the MCP server without the iss parameter", () =>
    runTest(
      Effect.gen(function* () {
        const { server, signIn } = yield* awaited(startServer({ cimd: true }));
        yield* awaited(signIn(cimd));

        const id = createHash("sha256")
          .update(server.url)
          .digest()
          .subarray(0, 9)
          .toString("base64url");
        const [authorization] = server.authorizations;
        expect(authorization?.get("client_id")).toBe(`https://pi.dev/oauth/${id}/client.json`);
        const redirect = new URL(authorization?.get("redirect_uri") ?? "");
        expect(redirect.pathname).toBe(`/callback/${id}`);
        expect(server.registrations).toEqual([]);
        expect(server.tokenRequests[0]?.get("redirect_uri")).toBe(redirect.href);
      }),
    ));

  it("replaces a registered client when switching to the document", () =>
    runTest(
      Effect.gen(function* () {
        const { server, store, signIn } = yield* awaited(
          startServer({ cimd: true, issParameter: true }),
        );
        yield* awaited(signIn({}));
        expect((yield* awaited(store.load()))?.clientInformation?.client_id).toBe("client-1");
        yield* awaited(signIn(cimd));

        expect(
          server.authorizations.map((authorization) => authorization.get("client_id")),
        ).toEqual(["client-1", "https://pi.dev/oauth/client.json"]);
        expect((yield* awaited(store.load()))?.clientInformation).toBeUndefined();
      }),
    ));

  it("accepts the authorization response only on the server-specific redirect URI", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const { signIn } = yield* awaited(startServer({ cimd: true, redirectPath: "/callback" }));
        yield* awaited(expect(signIn(cimd)).rejects.toThrow("arrived on another redirect URI"));

        const { signIn: signInByPaste } = yield* awaited(startServer({ cimd: true }));
        let shown: URL | undefined;
        const paste: McpSignInPrompt = {
          showAuthorizationUrl: (url) => {
            shown = url;
          },
          promptForRedirectUrl: () =>
            effectRunPromise(
              Effect.gen(function* () {
                const redirect = new URL(shown?.searchParams.get("redirect_uri") ?? "");
                redirect.pathname = "/callback";
                redirect.search = `?code=code-1&state=${shown?.searchParams.get("state")}`;
                return yield* awaited(redirect.href);
              }),
            ),
        };
        yield* awaited(
          expect(signInByPaste(cimd, paste)).rejects.toThrow(
            "does not match this sign-in's redirect URI",
          ),
        );
      }),
    ));

  it("fails instead of registering when the server does not support documents", () =>
    runTest(
      Effect.gen(function* () {
        const { server, signIn } = yield* awaited(startServer({ issParameter: true }));
        yield* awaited(
          expect(signIn(cimd)).rejects.toThrow("does not support Client ID Metadata Documents"),
        );
        expect(server.registrations).toEqual([]);
      }),
    ));
});
