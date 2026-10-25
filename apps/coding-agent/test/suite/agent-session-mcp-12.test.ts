import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import closeAgentSessionModule from "../close-agent-session.ts";
import agentSessionMcpSupport from "./agent-session-mcp-support.ts";

const { cleanupAll } = closeAgentSessionModule;

const { fauxAssistantMessage } = ai;

const { harnesses4, loadDocsSearch, setup4 } = agentSessionMcpSupport;

const doesNotActivateRestoredToolsThat = Effect.gen(function* () {
  const first = yield* Effect.promise(() => setup4());
  yield* Effect.promise(() => loadDocsSearch(first.harness));

  const second = yield* Effect.promise(() => setup4(first.harness.sessionManager, [], 200));
  second.harness.setResponses([fauxAssistantMessage("done")]);
  yield* Effect.promise(() => second.harness.session.run.prompting.prompt("go"));
  yield* Effect.promise(() =>
    vi.waitFor(() =>
      expect(
        second.harness.session.tools.registry
          .getAllTools()
          .some((tool) => tool.name === "mcp__docs__search"),
      ).toBe(true),
    ),
  );

  expect(second.harness.session.tools.loadout.getActiveToolNames()).not.toContain(
    "mcp__docs__search",
  );
});

const declaresToolsToolSearchLoadedAgain2 = Effect.gen(function* () {
  const { harness, connected } = yield* Effect.promise(() => setup4());
  yield* Effect.promise(() => loadDocsSearch(harness));

  yield* Effect.promise(() => harness.session.extensions.runtime.reload());

  yield* Effect.promise(() => vi.waitFor(() => expect(connected).toEqual(["docs", "docs"])));
  yield* Effect.promise(() =>
    vi.waitFor(() =>
      expect(harness.session.tools.loadout.getActiveToolNames()).toContain("mcp__docs__search"),
    ),
  );
});

const doesNotActivateRestoredToolsThatRegister = () =>
  Effect.runPromise(doesNotActivateRestoredToolsThat);

const declaresToolsToolSearchLoadedAgainAfter = () =>
  Effect.runPromise(declaresToolsToolSearchLoadedAgain2);

describe("AgentSession MCP tools after resume and reload", () => {
  afterEach(() => cleanupAll(harnesses4));

  it(
    "does not activate restored tools that register after the next prompt starts",
    doesNotActivateRestoredToolsThatRegister,
  );

  it(
    "declares tools tool_search loaded again after /reload",
    declaresToolsToolSearchLoadedAgainAfter,
  );
});
