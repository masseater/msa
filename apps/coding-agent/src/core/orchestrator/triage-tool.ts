import { type Static, Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import goalItemsModule from "./goal-items.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type triageTypes from "./triage.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { goalItems } = goalItemsModule;
const { store } = storeModule;

const CONCLUDE_TRIAGE = "conclude_triage";

const schema = Type.Object({
  conclusion: Type.Union(
    [Type.Literal("decided"), Type.Literal("needs-human"), Type.Literal("repeat")],
    {
      description:
        "decided: no human is needed, and the thread that stopped continues with your way. needs-human: only the user can decide. repeat: the request asks the same thing as an earlier triage decision of this task, so following it again would not move the work.",
    },
  ),
  decision: Type.String({
    description:
      "decided: the way to proceed, as the thread that stopped should follow it. needs-human: what exactly the user has to decide.",
  }),
  goalItems: Type.Optional(
    Type.Array(
      Type.Object({
        how: Type.String({ description: "How the way meets this item." }),
        item: Type.Integer({ description: "The goal item's number.", minimum: 1 }),
      }),
      { description: "decided: one entry for each goal item, numbered as in <goal-items>." },
    ),
  ),
  grounds: Type.String({
    description:
      "Which constraint each part of the way meets and how, and which past decision (a commit, an issue, a report, an AGENTS.md rule) it follows.",
  }),
  humanReason: Type.Optional(
    Type.Union(
      [
        Type.Literal("billing"),
        Type.Literal("personal-data"),
        Type.Literal("key-revocation"),
        Type.Literal("undecided-spec"),
      ],
      {
        description:
          "needs-human: why only the user can decide: billing, personal data, revoking an existing key or token, or a choice of specification nobody has made yet.",
      },
    ),
  ),
  leavesLimitation: Type.Boolean({
    description:
      "Whether the way leaves something undone as a known limitation, out of scope, a follow-up, or for later.",
  }),
  narrowsGoal: Type.Boolean({
    description: "Whether the way drops or narrows an item of the goal state.",
  }),
  noPrecedent: Type.Optional(
    Type.String({
      description: "needs-human: why neither the goal, the code, nor any past decision answers it.",
    }),
  ),
  relaxesRule: Type.Boolean({
    description:
      "Whether the way relaxes a rule of the repository, its AGENTS.md, or the task's checks.",
  }),
  repeats: Type.Optional(
    Type.Integer({
      description: "repeat: the number of the earlier decision in <earlier-triage-decisions>.",
      minimum: 1,
    }),
  ),
});

type Params = Static<typeof schema>;

function compromisesOf(params: Params): string[] {
  return [
    ...(params.narrowsGoal ? ["narrows the goal"] : []),
    ...(params.relaxesRule ? ["relaxes a rule"] : []),
    ...(params.leavesLimitation ? ["leaves something as a known limitation"] : []),
  ];
}

function itemsProblem(params: Params, count: number): string | undefined {
  const entries = params.goalItems ?? [];
  const seen = new Set(
    entries.filter((entry) => entry.how.trim() !== "").map((entry) => entry.item),
  );
  const missing = Array.from({ length: count }, (_, index) => index + 1).filter(
    (item) => !seen.has(item),
  );
  if (entries.length === count && missing.length === 0) return undefined;
  return `A decided way says how it meets each of the ${count} goal items; none says how it meets item ${missing.join(", ")}.`;
}

function repeatOf(params: Params, earlier: number): triageTypes.Conclusion {
  const { decision, grounds, repeats } = params;
  if (repeats === undefined || repeats > earlier) {
    throw new Error(
      earlier === 0
        ? "No earlier triage of this task decided anything, so nothing repeats: decide or hand it to a human."
        : `repeat needs repeats, the number (1 to ${earlier}) of the earlier decision this request repeats.`,
    );
  }
  return { conclusion: "repeat", decision, grounds, repeats };
}

function conclusionOf(params: Params, count: number, earlier: number): triageTypes.Conclusion {
  const { decision, grounds } = params;
  if (params.conclusion === "repeat") return repeatOf(params, earlier);
  const compromises = compromisesOf(params);
  if (compromises.length > 0) return { compromises, conclusion: "compromise", decision, grounds };
  if (params.conclusion === "needs-human") {
    const { humanReason, noPrecedent } = params;
    if (humanReason === undefined || noPrecedent === undefined || noPrecedent.trim() === "") {
      throw new Error(
        "needs-human needs humanReason (billing, personal-data, key-revocation, or undecided-spec) and noPrecedent. When none of those applies, a human is not needed: decide.",
      );
    }
    return { conclusion: "needs-human", decision, grounds, humanReason, noPrecedent };
  }
  const problem = itemsProblem(params, count);
  if (problem !== undefined) throw new Error(problem);
  return { conclusion: "decided", decision, goalItems: params.goalItems ?? [], grounds };
}

function concludeTool(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  task: orchestratorTypesTypes.Task,
): extensionsTypesTypes.ToolDefinition {
  const definition: extensionsTypesTypes.ToolDefinition<typeof schema, undefined> = {
    description:
      "Conclude the triage of a decision request, once, and end the turn: decided hands your way to the thread that stopped, which continues with it; needs-human hands the request to the orchestrator; repeat, for a request an earlier triage of this task already decided, hands it to the orchestrator too. A way that narrows the goal, relaxes a rule, or leaves a known limitation goes to the orchestrator as a compromise.",
    execute: (_toolCallId, params) => {
      const goalState = store.getTask(runtime.database, task.id)?.goalState ?? task.goalState;
      try {
        runtime.triageConclusions.set(
          threadId,
          conclusionOf(
            params,
            goalItems(goalState).length,
            store.triageDecisionsOf(runtime.database, task.id).length,
          ),
        );
      } catch (error) {
        return Promise.reject(error);
      }
      return Promise.resolve({
        content: [{ text: "Recorded. The turn ends here.", type: "text" }],
        details: undefined,
        terminate: true,
      });
    },
    label: "conclude triage",
    name: CONCLUDE_TRIAGE,
    parameters: schema,
    promptGuidelines: [
      "End the triage with conclude_triage. Decide whenever the goal, the code, and past decisions answer the request; needs-human only for billing, personal data, revoking an existing key, or an unmade choice of specification.",
    ],
    promptSnippet: "Conclude whether a decision request needs a human",
  };
  return definition as extensionsTypesTypes.ToolDefinition;
}

const triageTool = { CONCLUDE_TRIAGE, concludeTool };

export default triageTool;
