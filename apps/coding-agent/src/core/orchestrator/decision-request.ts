import { Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import progressStore from "./progress-store.ts";
import type runtimeTypes from "./runtime.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const REQUEST_DECISION = "request_decision";

const schema = Type.Object({
  options: Type.Array(
    Type.Object({
      choice: Type.String({ description: "One way to proceed." }),
      tradeoffs: Type.String({
        description: "What this choice gives up or costs, and what it changes in the goal.",
      }),
    }),
    { description: "The ways to proceed you can see.", minItems: 1 },
  ),
  recommendation: Type.Optional(
    Type.String({ description: "The choice you would take, and why." }),
  ),
  unmet: Type.String({
    description:
      "Which items of the goal state the work cannot meet, or where the goal contradicts itself or the code, and why.",
  }),
});

interface Request {
  unmet: string;
  options: readonly { choice: string; tradeoffs: string }[];
  recommendation?: string | undefined;
}

function requestText(role: orchestratorTypesTypes.ThreadRole, request: Request): string {
  return [
    `Decision requested by the ${role}: the goal cannot be met as it stands, so the task is not complete. The ${role} continues from where it stopped once the way to proceed is decided.`,
    `<unmet>\n${request.unmet}\n</unmet>`,
    "<options>",
    ...request.options.map(
      (option, index) => `${index + 1}. ${option.choice}\n   Tradeoffs: ${option.tradeoffs}`,
    ),
    "</options>",
    ...(request.recommendation === undefined
      ? []
      : [`<recommendation>\n${request.recommendation}\n</recommendation>`]),
  ].join("\n");
}

function requestDecisionTool(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  role: orchestratorTypesTypes.ThreadRole,
): extensionsTypesTypes.ToolDefinition {
  const definition: extensionsTypesTypes.ToolDefinition<typeof schema, undefined> = {
    description:
      "End this task's turn without passing or completing it, and ask for a decision on how to proceed. Use it when the goal state cannot be met as written, or contradicts itself or the code, instead of narrowing the goal, leaving an item as a known limitation, or calling it out of scope. A read-only triage thread looks at it first and answers it when the goal, the code, and past decisions do; otherwise the orchestrator decides. Either way you continue from here with the decision. A message that reaches you after this call cancels the request; call it again if the decision is still needed.",
    execute: (_toolCallId, params) => {
      runtime.decisionRequests.set(threadId, {
        key: progressStore.askKey(params.unmet),
        text: requestText(role, params),
      });
      return Promise.resolve({
        content: [
          {
            text: "Recorded. The turn ends here; the task waits for the orchestrator's decision.",
            type: "text",
          },
        ],
        details: undefined,
        terminate: true,
      });
    },
    label: "request decision",
    name: REQUEST_DECISION,
    parameters: schema,
    promptGuidelines: [
      "When an item of the goal state cannot be met, or the goal contradicts itself, call request_decision instead of passing, completing, narrowing the goal, or writing the gap down as a known limitation or out of scope.",
    ],
    promptSnippet: "Stop and ask the orchestrator to decide how to proceed",
  };
  return definition as extensionsTypesTypes.ToolDefinition;
}

const decisionRequest = { requestDecisionTool };

export default decisionRequest;
