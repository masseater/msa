import testing from "@msa/testing";
import { Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";

import InMemoryAuthStorageBackend from "../../src/core/in-memory-auth-storage-backend.ts";
import type configTypes from "../../src/extensions/mcp/config.types.ts";
import extension from "../../src/extensions/mcp/extension.ts";
import McpOAuthCredentialStore from "../../src/extensions/mcp/mcp-oauth-credential-store.ts";
import harnessModule from "./harness.ts";
import mcpOauthServer from "./mcp-oauth-server.ts";

const { createMcpExtension } = extension;
const { awaited, runTest } = testing;

const { createHarness, createTestUiContext } = harnessModule;

const { startOAuthMcpServer } = mcpOauthServer;

type Browser = "follow" | "paste";

const cleanups: (() => Promise<void> | void)[] = [];

const runCleanups = (): Promise<void> =>
  runTest(
    Effect.gen(function* () {
      while (cleanups.length > 0) yield* awaited(cleanups.pop()?.());
    }),
  );

const oauthRuntime = ManagedRuntime.make(
  Layer.provide(
    FetchHttpClient.layer,
    Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" }),
  ),
);

const visitAuthorizationUrl = (url: URL, browser: Browser): Promise<string> =>
  oauthRuntime.runPromise(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.get(url).pipe(Effect.orDie);
      const location = response.headers["location"] ?? "";
      if (browser === "follow" && response.status >= 300 && location !== "") {
        const followed = yield* client.get(new URL(location, url)).pipe(Effect.orDie);
        yield* followed.text.pipe(Effect.orDie);
      }
      return location;
    }),
  );

const NO_REDIRECT: Effect.Effect<string | undefined> = Effect.as(Effect.void, undefined);

const untilAborted = (signal: AbortSignal | undefined): Promise<string | undefined> =>
  runTest(
    Effect.callback<string | undefined>((resume) => {
      if (signal?.aborted === true) {
        resume(NO_REDIRECT);
        return undefined;
      }
      const onAbort = () => resume(NO_REDIRECT);
      signal?.addEventListener("abort", onAbort, { once: true });
      return Effect.sync(() => signal?.removeEventListener("abort", onAbort));
    }),
  );

const startServer = Effect.fn("startServer")(function* (
  oauth: configTypes.McpOAuthConfig | undefined,
) {
  const server = yield* awaited(startOAuthMcpServer());
  cleanups.push(server.close);
  const entry: configTypes.McpServerEntry = {
    config: { exposure: "direct", url: server.url, ...(oauth === undefined ? {} : { oauth }) },
    name: "issues",
    source: "test",
  };
  return { entry, server };
});

const setup = (browser: Browser, oauth?: configTypes.McpOAuthConfig) =>
  runTest(
    Effect.gen(function* () {
      const { entry, server } = yield* startServer(oauth);
      const backend = new InMemoryAuthStorageBackend();
      const notifications: string[] = [];
      const opened: URL[] = [];
      let redirectLocation: Promise<string> | undefined;
      const harness = yield* awaited(
        createHarness({
          extensionFactories: [
            createMcpExtension({
              credentials: new McpOAuthCredentialStore(backend),
              loadConfig: () => ({ errors: [], servers: [entry] }),
              openUrl: (url) => {
                opened.push(new URL(url));
                redirectLocation = visitAuthorizationUrl(new URL(url), browser);
              },
            }),
          ],
          initialActiveToolNames: [],
        }),
      );
      cleanups.push(() => harness.cleanup());
      const input = (_title: string, _placeholder?: string, opts?: { signal?: AbortSignal }) =>
        browser === "paste" ? Promise.resolve(redirectLocation) : untilAborted(opts?.signal);
      const uiContext = createTestUiContext({
        input,
        notify: (message) => notifications.push(message),
      });
      yield* awaited(harness.session.extensions.binding.bindExtensions({ uiContext }));
      return { backend, harness, notifications, opened, server };
    }),
  );

const agentSessionMcpOauthHarness = {
  cleanups,
  runCleanups,
  setup,
  visitAuthorizationUrl,
};

export default agentSessionMcpOauthHarness;
