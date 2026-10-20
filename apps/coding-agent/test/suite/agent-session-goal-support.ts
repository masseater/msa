import type { AgentTool } from "@msa/agent-core";
import { type AssistantMessage, fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";

import { GOAL_ENTRY_TYPE, type GoalEntryData } from "../../src/core/goal.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { createHarness } = harnessModule;

const touchTool: AgentTool = {
  description: "Do some work",
  execute: () => Promise.resolve({ content: [{ text: "touched", type: "text" }], details: {} }),
  label: "Touch",
  name: "touch",
  parameters: Type.Object({}),
};

function workTurn(text: string): AssistantMessage[] {
  return [
    fauxAssistantMessage(fauxToolCall("touch", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage(text),
  ];
}

function goalEvents(harness: harnessTypes.Harness): GoalEntryData[] {
  return harness.sessionManager
    .getEntries()
    .flatMap((entry) =>
      entry.type === "custom" && entry.customType === GOAL_ENTRY_TYPE
        ? [entry.data as GoalEntryData]
        : [],
    );
}

const harnesses: harnessTypes.Harness[] = [];

function setup(sessionManager?: SessionManager): Promise<harnessTypes.Harness> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() =>
        createHarness({
          tools: [touchTool],
          ...(sessionManager === undefined ? {} : { sessionManager }),
        }),
      );
      harnesses.push(harness);
      return harness;
    }),
  );
}

const agentSessionGoalSupport = {
  goalEvents,
  harnesses,
  setup,
  touchTool,
  workTurn,
};

export default agentSessionGoalSupport;
