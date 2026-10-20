import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import { MCP_SERVERS_SECTION } from "../../src/extensions/mcp/index.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { awaited, runTest } = testing;

const declaredToolNames = (harness: harnessTypes.Harness): string[] =>
  harness.session.messages
    .filter((message): message is compatTypes.SystemMessage => message.role === "system")
    .flatMap((message) => (message.toolsAdded ?? []).map((tool) => tool.name));

const serversSection = (harness: harnessTypes.Harness): string | null | undefined => {
  let section: string | null | undefined;
  for (const message of harness.session.messages) {
    if (
      message.role === "system" &&
      message.sections !== undefined &&
      MCP_SERVERS_SECTION in message.sections
    ) {
      section = message.sections[MCP_SERVERS_SECTION];
    }
  }
  return section;
};

const nestedToolNames = (harness: harnessTypes.Harness): string[] =>
  harness.session.getCallableToolNames();

const loadDocsSearch = (harness: harnessTypes.Harness) =>
  runTest(
    Effect.gen(function* () {
      harness.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("tool_search", { limit: 1, query: "search the docs" })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("loaded"),
      ]);
      yield* awaited(harness.session.prompt("load"));
      expect(harness.session.getActiveToolNames()).toContain("mcp__docs__search");
    }),
  );

const agentSessionMcpInspect = {
  declaredToolNames,
  loadDocsSearch,
  nestedToolNames,
  serversSection,
};

export default agentSessionMcpInspect;
