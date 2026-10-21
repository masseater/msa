import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";
import { Type } from "typebox";

import goal from "../../src/core/goal.ts";
import type goalTypes from "../../src/core/goal.types.ts";
import type sessionManagerTypes from "../../src/core/session-manager.types.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { GOAL_ENTRY_TYPE } = goal;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createHarness } = harnessModule;

const touchTool: agentTypes.AgentTool = {
  description: "Do some work",
  execute: () => Promise.resolve({ content: [{ text: "touched", type: "text" }], details: {} }),
  label: "Touch",
  name: "touch",
  parameters: Type.Object({}),
};

function workTurn(text: string): aiTypes.AssistantMessage[] {
  return [
    fauxAssistantMessage(fauxToolCall("touch", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage(text),
  ];
}

function goalEvents(harness: harnessTypes.Harness): goalTypes.GoalEntryData[] {
  return harness.sessionManager
    .getEntries()
    .flatMap((entry) =>
      entry.type === "custom" && entry.customType === GOAL_ENTRY_TYPE
        ? [entry.data as goalTypes.GoalEntryData]
        : [],
    );
}

const harnesses: harnessTypes.Harness[] = [];

function setup(sessionManager?: sessionManagerTypes.SessionManager): Promise<harnessTypes.Harness> {
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
