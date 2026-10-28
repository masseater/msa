import testing from "@msa/testing";
import { Effect } from "effect";

import InMemoryAuthStorageBackend from "../../src/core/in-memory-auth-storage-backend.ts";
import McpOAuthCredentialStore from "../../src/extensions/mcp/mcp-oauth-credential-store.ts";
import agentSessionMcpOauthHarness from "./agent-session-mcp-oauth-harness.ts";
import harnessModule from "./harness.ts";
import mcpOauthServer from "./mcp-oauth-server.ts";

const { awaited, runTest } = testing;
const { createHarness } = harnessModule;
const { startOAuthMcpServer } = mcpOauthServer;
const { cleanups, visitAuthorizationUrl } = agentSessionMcpOauthHarness;

const startSepiace = (reply: (request: string) => string | { error: string } = () => "") =>
  runTest(
    Effect.gen(function* () {
      const server = yield* awaited(startOAuthMcpServer({ memory: reply }));
      cleanups.push({ cleanup: server.close });
      return server;
    }),
  );

const openSession = (options: {
  url: string;
  backend?: NonNullable<ConstructorParameters<typeof McpOAuthCredentialStore>[0]>;
  agentDir?: string;
  signIn?: boolean;
  settings?: { memory?: Record<string, unknown> } & Record<string, unknown>;
}) =>
  runTest(
    Effect.gen(function* () {
      const backend = options.backend ?? new InMemoryAuthStorageBackend();
      const openedUrls: string[] = [];
      const harness = yield* awaited(
        createHarness({
          initialActiveToolNames: ["memory"],
          memoryConnection: {
            credentials: new McpOAuthCredentialStore(backend, options.agentDir),
            openUrl: (url) => {
              openedUrls.push(url);
              void visitAuthorizationUrl(new URL(url), "follow");
            },
          },
          settings: {
            ...options.settings,
            memory: { ...options.settings?.memory, url: options.url },
          },
          ...(options.agentDir === undefined ? {} : { tempDir: options.agentDir }),
        }),
      );
      cleanups.push(harness);
      const service = harness.session.integrations.memory.memory;
      const note =
        options.signIn === false || service === undefined
          ? undefined
          : yield* awaited(service.signIn(AbortSignal.timeout(10_000)));
      return { backend, harness, note, openedUrls };
    }),
  );

const sepiaceMemorySupport = { openSession, startSepiace };

export default sepiaceMemorySupport;
