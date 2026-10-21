import oauth from "@msa/mcp/oauth";
import type oauthTypes from "@msa/mcp/oauth.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import oauthModule from "../src/extensions/mcp/oauth.ts";
import type oauthTypesNs from "../src/extensions/mcp/oauth.types.ts";
import mcpOAuthMemoryStore from "./mcp-oauth-memory-store.ts";
import mcpOauthBrowser from "./suite/mcp-oauth-browser.ts";
import mcpOauthServer from "./suite/mcp-oauth-server.ts";
const { createMcpAuthProvider, signInMcpServer } = oauthModule;
const { memoryBackend, memoryServerStore } = mcpOAuthMemoryStore;

const { OAuthIssuerMismatchError } = oauth;

const { startOAuthMcpServer } = mcpOauthServer;

const { browserPrompt } = mcpOauthBrowser;

const { awaited, makeTempDir, readDirectory, removeDir, runTest } = testing;

const cleanups2: (() => Promise<void> | void)[] = [];

function signedIn() {
  return runTest(
    Effect.gen(function* () {
      const server = yield* awaited(startOAuthMcpServer());
      cleanups2.push(server.close);
      const lockDir = yield* makeTempDir("msa-mcp-refresh-");
      cleanups2.push(() => runTest(removeDir(lockDir)));

      const backend = memoryBackend();
      const process = () => {
        const store = memoryServerStore(server.url, { backend, lockDir });
        const provider = createMcpAuthProvider({
          onChallenge: () => {},
          serverUrl: server.url,
          settings: () => ({}),
          store,
        });
        return { provider, store };
      };
      yield* awaited(
        signInMcpServer({
          prompt: browserPrompt(),
          serverUrl: server.url,
          settings: {},
          store: process().store,
        }),
      );
      return yield* awaited({ lockDir, process, server });
    }),
  );
}

const refreshesOnceWhenSeveralProcessesFindThe = () =>
  runTest(
    Effect.gen(function* () {
      const { server, lockDir, process } = yield* awaited(signedIn());
      server.expireAccessTokens();
      const processes = [process(), process(), process()];

      yield* awaited(
        Promise.all(
          processes.map(({ provider }) =>
            provider.onUnauthorized?.({
              fetch: globalThis.fetch,
              response: new Response(null, { status: 401 }),
              serverUrl: new URL(server.url),
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
  );

const waitsForARunningRefreshToSave = () =>
  runTest(
    Effect.gen(function* () {
      const { server, process } = yield* awaited(signedIn());
      server.expireAccessTokens();
      const { store, provider } = process();

      const refresh = provider.onUnauthorized?.({
        fetch: globalThis.fetch,
        response: new Response(null, { status: 401 }),
        serverUrl: new URL(server.url),
        token: "access-1",
      });
      yield* awaited(provider.settled());
      expect((yield* awaited(store.load()))?.tokens?.access_token).toBe("access-2");
      yield* awaited(refresh);
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      while (cleanups2.length > 0) yield* awaited(cleanups2.pop()?.());
    }),
  );

describe("MCP OAuth refresh", () => {
  afterEach(afterEachHook);

  it(
    "refreshes once when several processes find the same token rejected",
    refreshesOnceWhenSeveralProcessesFindThe,
  );

  it("waits for a running refresh to save the new tokens", waitsForARunningRefreshToSave);
});

function signIn2(
  options: { iss?: string },
  settings: (serverUrl: string) => oauthTypesNs.McpOAuthSettings = () => ({}),
) {
  return runTest(
    Effect.gen(function* () {
      const server = yield* awaited(startOAuthMcpServer(options));
      try {
        yield* awaited(
          signInMcpServer({
            prompt: browserPrompt(),
            serverUrl: server.url,
            settings: settings(server.url),
            store: memoryServerStore(server.url),
          }),
        );
      } finally {
        yield* awaited(server.close());
      }
    }),
  );
}

const rejectsAnAuthorizationResponseFromAnotherIssuer = () =>
  runTest(
    awaited(
      expect(signIn2({ iss: "https://attacker.example" })).rejects.toBeInstanceOf(
        OAuthIssuerMismatchError,
      ),
    ),
  );

const keepsTheGrantedScopeWhenTheServer = () =>
  runTest(
    Effect.gen(function* () {
      const server = yield* awaited(startOAuthMcpServer());
      try {
        const store = memoryServerStore(server.url);
        const opened: URL[] = [];
        const signInWith = (challenge: oauthTypes.OAuthChallenge) =>
          signInMcpServer({
            challenge,
            prompt: browserPrompt((url) => opened.push(url)),
            serverUrl: server.url,
            settings: {},
            store,
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
  );

const usesTheConfiguredAuthorizationServerMetadataUrl = () =>
  runTest(
    Effect.gen(function* () {
      const settings = (serverUrl: string) => ({
        authServerMetadataUrl: new URL("/missing", serverUrl),
      });
      yield* awaited(
        expect(signIn2({}, settings)).rejects.toThrow(
          "HTTP 404 loading authorization server metadata",
        ),
      );
    }),
  );

describe("MCP OAuth sign-in", () => {
  it(
    "rejects an authorization response from another issuer",
    rejectsAnAuthorizationResponseFromAnotherIssuer,
  );

  it("keeps the granted scope when the server asks for more", keepsTheGrantedScopeWhenTheServer);

  it(
    "uses the configured authorization server metadata URL",
    usesTheConfiguredAuthorizationServerMetadataUrl,
  );
});
