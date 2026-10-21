import { Function } from "effect";

import type modelCallTypes from "./model-call.types.ts";

const isModelFirst = (args: ArrayLike<unknown>): boolean => {
  const first = args[0];
  return typeof first === "object" && first !== null && "api" in first;
};

const modelCall = <TModel, TContext, TOptions, TResult>(
  call: (model: TModel, context: TContext, options?: TOptions) => TResult,
): modelCallTypes.ModelCall<TModel, TContext, TOptions, TResult> =>
  Function.dual(isModelFirst, call);

const modelCallModule = {
  modelCall,
};

export default modelCallModule;
