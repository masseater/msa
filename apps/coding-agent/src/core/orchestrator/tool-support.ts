import { ModelThinkingLevelSchema } from "@msa/ai/providers/model-schema";
import { type Static, type TSchema, Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";

export const modelSchema = Type.String({ description: 'Model as "provider/id".' });
export const taskIdSchema = Type.String({ description: "Task id." });
export const taskIdObject = Type.Object({ taskId: taskIdSchema });

export const dependencySchema = Type.Object({
  taskId: taskIdSchema,
  dependsOn: taskIdSchema,
});

export const prioritySchema = Type.Object({
  taskId: taskIdSchema,
  priority: Type.Integer({ description: "Higher runs first." }),
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
