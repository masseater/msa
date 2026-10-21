import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, vi } from "vite-plus/test";

import type configTypes from "../../src/extensions/mcp/config.types.ts";
import agentSessionMcpHarness from "./agent-session-mcp-harness.ts";
import type agentSessionMcpSetupTypes from "./agent-session-mcp-setup.types.ts";

const { awaited, runTest } = testing;

const { createMcpHarness } = agentSessionMcpHarness;

const docsEntry = (
  exposure: configTypes.McpExposure,
  toolExposure: Record<string, configTypes.McpExposure> | undefined,
  description: string | undefined,
): configTypes.McpServerEntry => ({
  config: {
    exposure,
    url: "http://unused.invalid",
    ...(toolExposure === undefined ? {} : { toolExposure }),
    ...(description !== undefined && description !== "" ? { description } : {}),
  },
  name: "docs",
  source: "test",
});

const waitForSearchTool = (harness: {
  session: { tools: { registry: { getAllTools(): { name: string }[] } } };
}) =>
  awaited(
    vi.waitFor(() =>
      expect(
        harness.session.tools.registry
          .getAllTools()
          .some((tool) => tool.name === "mcp__docs__search"),
      ).toBe(true),
    ),
  );

const setup = (
  exposure: configTypes.McpExposure,
  listTools?: () => unknown[],
  options: agentSessionMcpSetupTypes.SetupOptions = {},
) =>
  runTest(
    Effect.gen(function* () {
      const {
        allowedToolNames,
        builtInTools,
        description,
        excludedToolNames,
        extensionFactories = [],
        instructions,
        resources,
        sessionManager,
        toolExposure,
        waitForTools = true,
        withoutToolSearch = false,
        ...config
      } = options;
      const result = yield* createMcpHarness({
        config,
        entry: docsEntry(exposure, toolExposure, description),
        extensionFactories,
        harness: {
          allowedToolNames,
          excludedToolNames,
          initialActiveToolNames: allowedToolNames ?? builtInTools ?? [],
          sessionManager,
        },
        server: { instructions, listTools, resources },
        withoutToolSearch,
      });
      if (waitForTools) {
        yield* waitForSearchTool(result.harness);
      }
      return result;
    }),
  );

const setupSlow = (
  config: agentSessionMcpSetupTypes.SlowConfig,
  initializeDelayMs: number,
  startupWaitMs?: number,
) => {
  const { name = "slow", instructions, ...serverConfig } = config;
  return runTest(
    createMcpHarness({
      entry: { config: { url: "http://unused.invalid", ...serverConfig }, name, source: "test" },
      harness: { initialActiveToolNames: [] },
      server: { initializeDelayMs, instructions },
      ...(startupWaitMs === undefined ? {} : { startupWaitMs }),
    }),
  );
};

const agentSessionMcpSetup = {
  setup,
  setupSlow,
};

export default agentSessionMcpSetup;
