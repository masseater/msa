import { Effect } from "effect";
import { type Static, Type } from "typebox";

import type { AgentTool, AgentToolResult } from "../../src/types.ts";

export interface CalculateResult extends AgentToolResult<undefined> {
  content: Array<{ type: "text"; text: string }>;
  details: undefined;
}

export function calculate(expression: string): CalculateResult {
  try {
    const result: unknown = new Function(`return ${expression}`)();
    return {
      content: [{ type: "text", text: `${expression} = ${String(result)}` }],
      details: undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message === "" ? String(error) : message, { cause: error });
  }
}

const calculateSchema = Type.Object({
  expression: Type.String({ description: "The mathematical expression to evaluate" }),
});

type CalculateParams = Static<typeof calculateSchema>;

export const calculateTool: AgentTool<typeof calculateSchema, undefined> = {
  label: "Calculator",
  name: "calculate",
  description: "Evaluate mathematical expressions",
  parameters: calculateSchema,
  execute: (_toolCallId: string, args: CalculateParams) =>
    Effect.runPromise(Effect.sync(() => calculate(args.expression))),
};
