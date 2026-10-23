import modelSchemaModule from "@msa/ai/providers/model-schema";
import { type Static, type TSchema, Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";

const { ModelThinkingLevelSchema } = modelSchemaModule;

const modelSchema = Type.String({ description: 'Model as "provider/id".' });
const taskIdSchema = Type.String({ description: "Task id." });
const taskIdObject = Type.Object({ taskId: taskIdSchema });

const checksSchema = Type.Array(
  Type.Object({
    command: Type.String({
      description:
        "Shell command run with /bin/sh in the worker's working directory (the task's worktree in a git repository), such as `vp lint`, `vp test apps/x`, or `rg -c 'layer-[0-9]' src`.",
    }),
    exitCode: Type.Optional(
      Type.Integer({
        description:
          "Exit code the command must return. Default 0. Use 1 for a search that must find nothing, such as rg or grep.",
        maximum: 255,
        minimum: 0,
      }),
    ),
    output: Type.Optional(
      Type.String({
        description:
          "Regular expression (multiline) that stdout and stderr together must match, such as `Found 0 errors and 0 warnings`.",
      }),
    ),
  }),
  {
    description:
      "Completion checks of the goal state. When the worker ends its turn, the harness runs each command in the worker's working directory before the reviewer starts; if one gives another result, the worker gets the results back and keeps working, and after 3 such rounds the task fails. Write one check per measurable part of the goal, and add checks that count the shortcuts that would satisfy the others in form only.",
  },
);

const dependsSchema = Type.Object({
  add: Type.Optional(
    Type.Array(taskIdSchema, {
      description:
        "Dependencies to add. Each must finish before the task starts, and its report joins the prompt.",
    }),
  ),
  remove: Type.Optional(Type.Array(taskIdSchema, { description: "Dependencies to drop." })),
  taskIds: Type.Array(taskIdSchema, {
    description: "Tasks whose dependencies change.",
  }),
});

const stateSchema = Type.Object({
  checks: Type.Optional(checksSchema),
  currentState: Type.Optional(
    Type.String({
      description: "What is true now. Replaces the task's current state. Facts, not steps.",
    }),
  ),
  goalState: Type.Optional(
    Type.String({
      description: "What should be true when the task is done. Replaces the task's goal state.",
    }),
  ),
  taskId: taskIdSchema,
});

const modelChangeSchema = Type.Object({
  model: modelSchema,
  taskId: taskIdSchema,
  thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
});

function text(value: string) {
  return { content: [{ text: value, type: "text" as const }], details: undefined };
}

function tool<TParams extends TSchema>(
  definition: Omit<
    extensionsTypesTypes.ToolDefinition<TParams, undefined>,
    "execute" | "defaultActive"
  > & {
    run: (params: Static<TParams>) => Promise<string>;
  },
): extensionsTypesTypes.ToolDefinition {
  const { run, ...rest } = definition;
  const typed: extensionsTypesTypes.ToolDefinition<TParams, undefined> = {
    ...rest,
    defaultActive: false,
    execute: (_toolCallId, params) => run(params).then(text),
  };
  return typed as extensionsTypesTypes.ToolDefinition;
}

const toolSupport = {
  checksSchema,
  dependsSchema,
  modelChangeSchema,
  modelSchema,
  stateSchema,
  taskIdObject,
  taskIdSchema,
  tool,
};

export default toolSupport;
