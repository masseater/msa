import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import closeAgentSessionModule from "../close-agent-session.ts";
import agentSessionMcpSupport from "./agent-session-mcp-support.ts";

const { cleanupAll } = closeAgentSessionModule;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { SERVER_TOOLS, harnesses, setup } = agentSessionMcpSupport;

describe("AgentSession MCP integration", () => {
  afterEach(() => cleanupAll(harnesses));

  it.each([false, true])(
    "routes tools whose names differ only in - and _ (reverse: %s)",
    (reverse) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const tools = [
            {
              description: "dashed",
              inputSchema: { properties: {}, type: "object" },
              name: "read-file",
            },
            {
              description: "underscored",
              inputSchema: { properties: {}, type: "object" },
              name: "read_file",
            },
          ];
          if (reverse) tools.reverse();
          const { harness, calls } = yield* Effect.promise(() =>
            setup("codemode", () => [...tools, ...SERVER_TOOLS]),
          );
          const code = `for (const query of ["dashed", "underscored"]) await tools[(await searchTools(query))[0].name]({});`;
          harness.setResponses([
            fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }),
            fauxAssistantMessage("done"),
          ]);

          yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

          expect(calls).toEqual(["read-file:{}", "read_file:{}"]);
        }),
      ),
  );
});
