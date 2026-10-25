import { Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import goalItemsModule from "./goal-items.ts";
import type reviewChecklistTypes from "./review-checklist.types.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { goalItems } = goalItemsModule;
const { store } = storeModule;

const RECORD_GOAL_ITEMS = "record_goal_items";

type Entry = reviewChecklistTypes.Entry;
type Checklist = reviewChecklistTypes.Checklist;
type Judgement = reviewChecklistTypes.Judgement;

function schemaFor(count: number) {
  return Type.Object({
    items: Type.Array(
      Type.Object({
        evidence: Type.String({
          description:
            "What in the work shows it: the file, the command and its output, or the part of the pull request.",
        }),
        item: Type.Integer({ description: "The goal item's number.", maximum: count, minimum: 1 }),
        status: Type.Union([Type.Literal("met"), Type.Literal("unmet")], {
          description:
            "met only when the work fully meets the item. Anything partly done, deferred, left as a known limitation, out of scope, a follow-up, or for a separate issue is unmet.",
        }),
      }),
      {
        description: `One entry for each of the ${count} goal items, numbered as in the goal-items list.`,
        maxItems: count,
        minItems: count,
      },
    ),
  });
}

function numbered(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function entriesProblem(entries: readonly Entry[], count: number): string | undefined {
  const seen = new Set(entries.map((entry) => entry.item));
  const missing = Array.from({ length: count }, (_, index) => index + 1).filter(
    (item) => !seen.has(item),
  );
  if (entries.length === count && missing.length === 0) return undefined;
  return `The goal has ${count} items; the record has ${entries.length} entries${missing.length === 0 ? "" : ` and none for item ${missing.join(", ")}`}.`;
}

function judge(goalState: string, checklist: Checklist | undefined): Judgement {
  const items = goalItems(goalState);
  if (checklist === undefined) {
    return {
      kind: "missing",
      text: `The reviewer did not record whether each goal item is met (${RECORD_GOAL_ITEMS}).`,
    };
  }
  if (checklist.goalState !== goalState) {
    return {
      kind: "mismatch",
      text: "The goal state changed after the reviewer recorded the goal items.",
    };
  }
  const problem = entriesProblem(checklist.entries, items.length);
  if (problem !== undefined) return { kind: "mismatch", text: problem };
  const lines = [...checklist.entries]
    .sort((left, right) => left.item - right.item)
    .map(
      (entry) =>
        `${entry.item}. [${entry.status}] ${items[entry.item - 1] ?? ""}\n   ${entry.evidence}`,
    );
  const unmet = checklist.entries.filter((entry) => entry.status === "unmet").length;
  return unmet === 0
    ? { kind: "met", text: `Goal items: all ${items.length} met.\n${lines.join("\n")}` }
    : {
        kind: "unmet",
        text: `Goal items: ${unmet} of ${items.length} unmet.\n${lines.join("\n")}`,
      };
}

function recordTool(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  task: orchestratorTypesTypes.Task,
): extensionsTypesTypes.ToolDefinition {
  const schema = schemaFor(goalItems(task.goalState).length);
  const definition: extensionsTypesTypes.ToolDefinition<typeof schema, undefined> = {
    description:
      "Record, for every item of the task's goal state, whether the work meets it. The review passes only when every item is recorded as met; an unmet item sends the work back however the report words it.",
    execute: (_toolCallId, params) => {
      const goalState = store.getTask(runtime.database, task.id)?.goalState ?? task.goalState;
      const problem = entriesProblem(params.items, goalItems(goalState).length);
      if (problem !== undefined) {
        return Promise.reject(
          new Error(`${problem} Record each item once:\n${numbered(goalItems(goalState))}`),
        );
      }
      runtime.goalChecklists.set(threadId, { entries: params.items, goalState });
      const unmet = params.items.filter((entry) => entry.status === "unmet").length;
      return Promise.resolve({
        content: [
          {
            text: `Recorded ${params.items.length} goal items, ${unmet} unmet.`,
            type: "text",
          },
        ],
        details: undefined,
      });
    },
    label: "record goal items",
    name: RECORD_GOAL_ITEMS,
    parameters: schema,
    promptGuidelines: [
      "Before ending a review, call record_goal_items with one entry for each goal item. Mark an item met only when the work fully meets it.",
    ],
    promptSnippet: "Record whether each goal item is met",
  };
  return definition as extensionsTypesTypes.ToolDefinition;
}

function recordPrompt(goalState: string, judgement: Judgement): string {
  return [
    "<goal-items-not-recorded>",
    `${judgement.text} The review cannot pass or fail without it. Call ${RECORD_GOAL_ITEMS} with one entry for each goal item below, then end your turn with your report.`,
    numbered(goalItems(goalState)),
    "</goal-items-not-recorded>",
  ].join("\n");
}

const reviewChecklist = { RECORD_GOAL_ITEMS, judge, numbered, recordPrompt, recordTool };

export default reviewChecklist;
