import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionMcpSupport from "./agent-session-mcp-support.ts";

const { fauxAssistantMessage } = ai;

const { SERVER_TOOLS, harnesses, nestedToolNames, setup } = agentSessionMcpSupport;

describe("AgentSession MCP integration", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it.each(["direct", "codemode"] as const)(
    "withdraws and restores %s MCP tools the server changes",
    (exposure) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
          let tools = SERVER_TOOLS;
          const { harness, servers } = yield* Effect.promise(() => setup(exposure, () => tools));
          harness.setResponses([fauxAssistantMessage("ready")]);
          yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));

          const reachable = () =>
            exposure === "direct"
              ? harness.session.tools.loadout.getActiveToolNames()
              : nestedToolNames(harness);
          const listChanged = () =>
            runPromise(
              Effect.gen(function* () {
                const [server] = servers;
                if (server === undefined) throw new Error("expected an MCP server");
                yield* Effect.promise(() =>
                  server.send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }),
                );
                yield* Effect.sleep(10);
              }),
            );
          expect(reachable()).toContain("mcp__docs__fail");

          tools = SERVER_TOOLS.filter((tool) => tool.name !== "fail");
          yield* Effect.promise(() => listChanged());
          expect(reachable()).not.toContain("mcp__docs__fail");
          expect(reachable()).toContain("mcp__docs__search");
          const codemode = harness.session.agent.state.tools.find(
            (tool) => tool.name === "codemode",
          );
          expect(codemode?.description ?? "").not.toContain("mcp__docs__fail");

          tools = SERVER_TOOLS;
          yield* Effect.promise(() => listChanged());
          expect(reachable()).toContain("mcp__docs__fail");
        }),
      ),
  );
});
