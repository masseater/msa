import { ModelThinkingLevelSchema } from "@msa/ai/providers/model-schema";
import { type Static, type TSchema, Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";

export const modelSchema = Type.String({ description: 'Model as "provider/id".' });
export const taskIdSchema = Type.String({ description: "Task id." });
export const taskIdObject = Type.Object({ taskId: taskIdSchema });

export const dependsSchema = Type.Object({
  taskIds: Type.Array(taskIdSchema, {
    description: "Tasks whose dependencies change.",
  }),
  add: Type.Optional(
    Type.Array(taskIdSchema, {
      description:
        "Dependencies to add. Each must finish before the task starts, and its report joins the prompt.",
    }),
  ),
  remove: Type.Optional(Type.Array(taskIdSchema, { description: "Dependencies to drop." })),
});

export const stateSchema = Type.Object({
  taskId: taskIdSchema,
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
});

export const modelChangeSchema = Type.Object({
  taskId: taskIdSchema,
  model: modelSchema,
  thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
});

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: undefined };
}

export function tool<TParams extends TSchema>(
  definition: Omit<ToolDefinition<TParams, undefined>, "execute" | "defaultActive"> & {
    run: (params: Static<TParams>) => Promise<string>;
  },
): ToolDefinition {
  const { run, ...rest } = definition;
  const typed: ToolDefinition<TParams, undefined> = {
    ...rest,
    defaultActive: false,
    execute: (_toolCallId, params) => run(params).then(text),
  };
  return typed as ToolDefinition;
}
