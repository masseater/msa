import testing from "@msa/testing";
import { Effect } from "effect";

import { createCodemodeExtension } from "../../src/extensions/codemode/index.ts";
import { createMcpExtension } from "../../src/extensions/mcp/index.ts";
import { createToolSearchExtension } from "../../src/extensions/tool-search/index.ts";
import type agentSessionMcpHarnessTypes from "./agent-session-mcp-harness.types.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";
import mcpFakeServer from "./mcp-fake-server.ts";

const { awaited } = testing;

const { createHarness, createTestUiContext } = harnessModule;

const { createFakeServer } = mcpFakeServer;

const harnesses: harnessTypes.Harness[] = [];

const mcpExtensions = (
  input: agentSessionMcpHarnessTypes.Input,
  calls: string[],
  servers: agentSessionMcpHarnessTypes.FakeServer[],
) => [
  ...(input.extensionFactories ?? []),
  createCodemodeExtension(),
  ...(input.withoutToolSearch === true ? [] : [createToolSearchExtension()]),
  createMcpExtension({
    createTransport: () => {
      const pair = createFakeServer(calls, input.server);
      servers.push(pair.server);
      void pair.server.start();
      return pair.client;
    },
    loadConfig: () => ({ errors: [], servers: [input.entry], ...input.config }),
    ...(input.startupWaitMs === undefined ? {} : { startupWaitMs: input.startupWaitMs }),
  }),
];

const createMcpHarness = Effect.fn("createMcpHarness")(function* (
  input: agentSessionMcpHarnessTypes.Input,
) {
  const calls: string[] = [];
  const notifications: string[] = [];
  const servers: agentSessionMcpHarnessTypes.FakeServer[] = [];
  const harness = yield* awaited(
    createHarness({
      ...input.harness,
      extensionFactories: mcpExtensions(input, calls, servers),
    }),
  );
  harnesses.push(harness);
  yield* awaited(
    harness.session.bindExtensions({
      uiContext: createTestUiContext({ notify: (message) => notifications.push(message) }),
    }),
  );
  return { calls, harness, notifications, servers };
});

const agentSessionMcpHarness = {
  createMcpHarness,
  harnesses,
};

export default agentSessionMcpHarness;
