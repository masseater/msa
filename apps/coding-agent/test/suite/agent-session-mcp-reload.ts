import testing from "@msa/testing";
import { Effect } from "effect";

import type extensionsTypesTypes from "../../src/core/extensions/types.types.ts";
import type sessionManagerTypes from "../../src/core/session-manager.types.ts";
import extensionModule from "../../src/extensions/mcp/extension.ts";
import extension from "../../src/extensions/tool-search/extension.ts";
import utilities from "../utilities.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";
import mcpFakeServer from "./mcp-fake-server.ts";

const { createToolSearchExtension } = extension;
const { createMcpExtension } = extensionModule;

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
  extensionFactories: extensionsTypesTypes.ExtensionFactory[],
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
  sessionManager?: sessionManagerTypes.SessionManager,
  extensionFactories: extensionsTypesTypes.ExtensionFactory[] = [],
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
