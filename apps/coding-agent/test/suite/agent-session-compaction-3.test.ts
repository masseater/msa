import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type srcTypes from "../../src/index.types.ts";
import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { harnesses } = agentSessionCompactionSupport;

const { createHarness } = harnessModule;

const afterEachHook3 = () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

const TOOL_RESULT = `large-tool-result:${"x".repeat(8000)}`;

const largeTool: agentTypes.AgentTool = {
  description: "Returns enough content to cross the compaction threshold",
  execute: () => Promise.resolve({ content: [{ text: TOOL_RESULT, type: "text" }], details: {} }),
  label: "Large result",
  name: "large_result",
  parameters: Type.Object({}),
};

const compactionSettings = (modelOverride: boolean) =>
  modelOverride
    ? {
        enabled: true,
        keepRecentTokens: 20000,
        modelOverrides: { "faux/faux-1": { keepRecentTokens: 1750, reserveTokens: 400 } },
        reserveTokens: 0,
      }
    : { enabled: true, keepRecentTokens: 1750, reserveTokens: 400 };

const summarizingExtension =
  (order: string[], observedSettings: unknown[]): srcTypes.ExtensionFactory =>
  (msa) => {
    msa.on("session_before_compact", (event) => {
      order.push("compaction");
      observedSettings.push(event.preparation.settings);
      return {
        compaction: {
          details: {},
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          summary: "compacted history",
          tokensBefore: event.preparation.tokensBefore,
        },
      };
    });
  };

const runOversizedToolTurn = Effect.fn("runOversizedToolTurn")(function* (modelOverride: boolean) {
  const order: string[] = [];
  const observedSettings: unknown[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [summarizingExtension(order, observedSettings)],
      models: [{ contextWindow: 3600, id: "faux-1", maxTokens: 100 }],
      settings: { compaction: compactionSettings(modelOverride) },
      tools: [largeTool],
    }),
  );
  harnesses.push(harness);
  const resumed = { request: "" };
  harness.setResponses([
    fauxAssistantMessage(`old-history:${"a".repeat(800)}`),
    fauxAssistantMessage(`recent-history:${"b".repeat(800)}`),
    fauxAssistantMessage(fauxToolCall("large_result", {}), { stopReason: "toolUse" }),
    (context) => {
      order.push("provider");
      resumed.request = JSON.stringify(context.messages);
      return fauxAssistantMessage("finished after compaction");
    },
  ]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("seed old history"));
  yield* Effect.promise(() => harness.session.run.prompting.prompt("seed recent history"));
  const agentStartsBefore = harness.eventsOfType("agent_start").length;
  yield* Effect.promise(() => harness.session.run.prompting.prompt("run the large tool"));
  return { agentStartsBefore, harness, observedSettings, order, resumedRequest: resumed.request };
});

const compactsAfterAnOversizedToolResult = (modelOverride: boolean) =>
  Effect.gen(function* () {
    const { agentStartsBefore, harness, observedSettings, order, resumedRequest } =
      yield* runOversizedToolTurn(modelOverride);
    expect(order.slice(0, 2)).toEqual(["compaction", "provider"]);
    expect(observedSettings[0]).toEqual({
      enabled: true,
      keepRecentTokens: 1750,
      reserveTokens: 400,
    });
    expect(harness.eventsOfType("agent_start")).toHaveLength(agentStartsBefore + 1);
    expect(harness.eventsOfType("compaction_start").at(-1)).toEqual({
      reason: "threshold",
      type: "compaction_start",
    });
    expect(resumedRequest).toContain("compacted history");
    expect(resumedRequest).toContain("large-tool-result");
    expect(harness.session.context.transcript.getLastAssistantText()).toBe(
      "finished after compaction",
    );
  });

describe("AgentSession compaction characterization", () => {
  afterEach(afterEachHook3);

  it.each([false, true])(
    "compacts after an oversized tool result in the same run (model override: %s)",
    (modelOverride) => Effect.runPromise(compactsAfterAnOversizedToolResult(modelOverride)),
  );
});
