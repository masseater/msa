import testing from "@msa/testing";
import { Effect } from "effect";

import config from "../../src/config.ts";
import InMemoryAuthStorageBackend from "../../src/core/in-memory-auth-storage-backend.ts";
import builtinServersModule from "../../src/extensions/mcp/builtin-servers.ts";
import extension from "../../src/extensions/mcp/extension.ts";
import McpOAuthCredentialStore from "../../src/extensions/mcp/mcp-oauth-credential-store.ts";
import agentSessionMcpOauthHarness from "./agent-session-mcp-oauth-harness.ts";
import harnessModule from "./harness.ts";
import mcpOauthServer from "./mcp-oauth-server.ts";

const { createMcpExtension } = extension;
const { awaited, runTest } = testing;
const { createHarness, createTestUiContext } = harnessModule;
const { startOAuthMcpServer } = mcpOauthServer;
const { cleanups, visitAuthorizationUrl } = agentSessionMcpOauthHarness;
const { getAgentDir } = config;
const { sepiaceEntry } = builtinServersModule;

const untilAborted = (signal: AbortSignal | undefined): Promise<string | undefined> =>
  runTest(
    Effect.callback<string | undefined>((resume) => {
      const done = () => resume(Effect.as(Effect.void, undefined));
      if (signal?.aborted === true) {
        done();
        return undefined;
      }
      signal?.addEventListener("abort", done, { once: true });
      return Effect.sync(() => signal?.removeEventListener("abort", done));
    }),
  );

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
  settings?: Record<string, unknown>;
  tui?: boolean;
  ui?: Parameters<typeof createTestUiContext>[0];
}) =>
  runTest(
    Effect.gen(function* () {
      const backend = options.backend ?? new InMemoryAuthStorageBackend();
      const builtin = sepiaceEntry(getAgentDir());
      const entry = { ...builtin, config: { ...builtin.config, url: options.url } };
      const notifications: string[] = [];
      const harness = yield* awaited(
        createHarness({
          extensionFactories: [
            createMcpExtension({
              credentials: new McpOAuthCredentialStore(backend),
              loadConfig: () => ({ errors: [], servers: [entry] }),
              openUrl: (url) => {
                void visitAuthorizationUrl(new URL(url), "follow");
              },
              updateConfig: () => Promise.resolve(),
            }),
          ],
          initialActiveToolNames: ["memory"],
          ...(options.agentDir === undefined ? {} : { tempDir: options.agentDir }),
          ...(options.settings === undefined ? {} : { settings: options.settings }),
        }),
      );
      cleanups.push(harness);
      const uiContext = createTestUiContext({
        input: (_title, _placeholder, opts) => untilAborted(opts?.signal),
        notify: (message) => notifications.push(message),
        ...options.ui,
      });
      yield* awaited(
        harness.session.extensions.binding.bindExtensions({
          uiContext,
          ...(options.tui === true ? { mode: "tui" as const } : {}),
        }),
      );
      if (options.signIn !== false)
        yield* awaited(harness.session.run.prompting.prompt("/mcp login sepiace"));
      return { backend, harness, notifications };
    }),
  );

const sepiaceMemorySupport = { openSession, startSepiace };

export default sepiaceMemorySupport;
