import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { InMemoryAuthStorageBackend } from "../src/core/auth-storage.ts";
import {
  McpOAuthCredentialStore,
  type McpOAuthSettings,
  type McpSignInPrompt,
  signInMcpServer,
} from "../src/extensions/mcp/oauth.ts";
import mcpOauthBrowser from "./suite/mcp-oauth-browser.ts";
import mcpOauthServer from "./suite/mcp-oauth-server.ts";

const { startOAuthMcpServer } = mcpOauthServer;

const { browserPrompt, clientDocumentId } = mcpOauthBrowser;

const { awaited, runTest } = testing;

const cleanups3: (() => Promise<void>)[] = [];

const cimd: McpOAuthSettings = { clientRegistration: "cimd" };

function startServer(options: { issParameter?: boolean; cimd?: boolean; redirectPath?: string }) {
  return runTest(
    Effect.gen(function* () {
      const server = yield* awaited(startOAuthMcpServer(options));
      cleanups3.push(server.close);
      const store = new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()).forServer(
        "test",
        server.url,
      );
      const browser: McpSignInPrompt = browserPrompt();
      const signIn = (settings: McpOAuthSettings, prompt = browser) =>
        signInMcpServer({ prompt, serverUrl: server.url, settings, store });
      return yield* awaited({ server, signIn, store });
    }),
  );
}

const registersDynamicallyByDefaultEvenWhenThe = () =>
  runTest(
    Effect.gen(function* () {
      const { server, signIn } = yield* awaited(startServer({ cimd: true, issParameter: true }));
      yield* awaited(signIn({}));
      expect(server.registrations).toHaveLength(1);
      expect(server.authorizations[0]?.get("client_id")).toBe("client-1");
    }),
  );

const usesMsaSDocumentWhenAuthorizationResponses = () =>
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
  );

const usesADocumentAndCallbackPathSpecific = () =>
  runTest(
    Effect.gen(function* () {
      const { server, signIn } = yield* awaited(startServer({ cimd: true }));
      yield* awaited(signIn(cimd));

      const id = yield* awaited(clientDocumentId(server.url));
      const [authorization] = server.authorizations;
      expect(authorization?.get("client_id")).toBe(`https://pi.dev/oauth/${id}/client.json`);
      const redirect = new URL(authorization?.get("redirect_uri") ?? "");
      expect(redirect.pathname).toBe(`/callback/${id}`);
      expect(server.registrations).toEqual([]);
      expect(server.tokenRequests[0]?.get("redirect_uri")).toBe(redirect.href);
    }),
  );

const replacesARegisteredClientWhenSwitchingTo = () =>
  runTest(
    Effect.gen(function* () {
      const { server, store, signIn } = yield* awaited(
        startServer({ cimd: true, issParameter: true }),
      );
      yield* awaited(signIn({}));
      expect((yield* awaited(store.load()))?.clientInformation?.client_id).toBe("client-1");
      yield* awaited(signIn(cimd));

      expect(server.authorizations.map((authorization) => authorization.get("client_id"))).toEqual([
        "client-1",
        "https://pi.dev/oauth/client.json",
      ]);
      expect((yield* awaited(store.load()))?.clientInformation).toBeUndefined();
    }),
  );

const acceptsTheAuthorizationResponseOnlyOnThe = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const { signIn } = yield* awaited(startServer({ cimd: true, redirectPath: "/callback" }));
      yield* awaited(expect(signIn(cimd)).rejects.toThrow("arrived on another redirect URI"));

      const { signIn: signInByPaste } = yield* awaited(startServer({ cimd: true }));
      let shown: URL | undefined;
      const paste: McpSignInPrompt = {
        promptForRedirectUrl: () =>
          effectRunPromise(
            Effect.gen(function* () {
              const redirect = new URL(shown?.searchParams.get("redirect_uri") ?? "");
              redirect.pathname = "/callback";
              redirect.search = `?code=code-1&state=${shown?.searchParams.get("state")}`;
              return yield* awaited(redirect.href);
            }),
          ),
        showAuthorizationUrl: (url) => {
          shown = url;
        },
      };
      yield* awaited(
        expect(signInByPaste(cimd, paste)).rejects.toThrow(
          "does not match this sign-in's redirect URI",
        ),
      );
    }),
  );

const failsInsteadOfRegisteringWhenTheServer = () =>
  runTest(
    Effect.gen(function* () {
      const { server, signIn } = yield* awaited(startServer({ issParameter: true }));
      yield* awaited(
        expect(signIn(cimd)).rejects.toThrow("does not support Client ID Metadata Documents"),
      );
      expect(server.registrations).toEqual([]);
    }),
  );

const afterEachHook2 = () =>
  runTest(
    Effect.gen(function* () {
      while (cleanups3.length > 0) yield* awaited(cleanups3.pop()?.());
    }),
  );

describe("MCP OAuth client ID metadata documents", () => {
  afterEach(afterEachHook2);

  it(
    "registers dynamically by default, even when the server supports documents",
    registersDynamicallyByDefaultEvenWhenThe,
  );

  it(
    "uses msa's document when authorization responses name their issuer",
    usesMsaSDocumentWhenAuthorizationResponses,
  );

  it(
    "uses a document and callback path specific to the MCP server without the iss parameter",
    usesADocumentAndCallbackPathSpecific,
  );

  it(
    "replaces a registered client when switching to the document",
    replacesARegisteredClientWhenSwitchingTo,
  );

  it(
    "accepts the authorization response only on the server-specific redirect URI",
    acceptsTheAuthorizationResponseOnlyOnThe,
  );

  it(
    "fails instead of registering when the server does not support documents",
    failsInsteadOfRegisteringWhenTheServer,
  );
});
