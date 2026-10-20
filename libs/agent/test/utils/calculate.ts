import { Effect } from "effect";
import { type Static, Type } from "typebox";

import type typesModule from "../../src/types.ts";
import type calculateTypes from "./calculate.types.ts";

function calculate(expression: string): calculateTypes.CalculateResult {
  try {
    const result: unknown = new Function(`return ${expression}`)();
    return {
      content: [{ text: `${expression} = ${String(result)}`, type: "text" }],
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

const calculateTool: typesModule.AgentTool<typeof calculateSchema, undefined> = {
  description: "Evaluate mathematical expressions",
  execute: (_toolCallId: string, args: CalculateParams) =>
    Effect.runPromise(Effect.sync(() => calculate(args.expression))),
  label: "Calculator",
  name: "calculate",
  parameters: calculateSchema,
};

const calculateModule = {
  calculate,
  calculateTool,
};

export default calculateModule;
