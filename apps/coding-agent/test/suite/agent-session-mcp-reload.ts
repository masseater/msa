import testing from "@msa/testing";
import { Effect } from "effect";

import type { ExtensionFactory } from "../../src/core/extensions/types.ts";
import type { SessionManager } from "../../src/core/session-manager.ts";
import { createMcpExtension } from "../../src/extensions/mcp/index.ts";
import { createToolSearchExtension } from "../../src/extensions/tool-search/index.ts";
import utilities from "../utilities.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";
import mcpFakeServer from "./mcp-fake-server.ts";

const { awaited, runTest } = testing;

const { createHarness, createTestUiContext } = harnessModule;

const { createTestExtensionsResult, createTestResourceLoader } = utilities;

const { createFakeServer } = mcpFakeServer;

const harnesses4: harnessTypes.Harness[] = [];

const DOCS = [
  {
    config: { exposure: "deferred" as const, url: "http://unused.invalid" },
    name: "docs",
    source: "test" as const,
  },
];

const reloadingFactories = (
  extensionFactories: ExtensionFactory[],
  initializeDelayMs: number,
  connected: string[],
) => [
  ...extensionFactories,
  createToolSearchExtension(),
  createMcpExtension({
    createTransport: (entry) => {
      connected.push(entry.name);
      const pair = createFakeServer([], { initializeDelayMs });
      void pair.server.start();
      return pair.client;
    },
    loadConfig: () => ({ errors: [], servers: DOCS }),
  }),
];

const setup4 = (
  sessionManager?: SessionManager,
  extensionFactories: ExtensionFactory[] = [],
  initializeDelayMs = 0,
) =>
  runTest(
    Effect.gen(function* () {
      const connected: string[] = [];
      const factories = reloadingFactories(extensionFactories, initializeDelayMs, connected);
      let extensions = yield* awaited(createTestExtensionsResult(factories));
      const resourceLoader = {
        ...createTestResourceLoader(),
        getExtensions: () => extensions,
        reload: () =>
          runTest(
            Effect.gen(function* () {
              extensions = yield* awaited(createTestExtensionsResult(factories));
            }),
          ),
      };
      const harness = yield* awaited(createHarness({ resourceLoader, sessionManager }));
      harnesses4.push(harness);
      yield* awaited(harness.session.bindExtensions({ uiContext: createTestUiContext() }));
      return { connected, harness };
    }),
  );

const agentSessionMcpReload = {
  harnesses4,
  setup4,
};

export default agentSessionMcpReload;
