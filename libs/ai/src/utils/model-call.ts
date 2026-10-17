import { Function } from "effect";

export interface ModelCall<TModel, TContext, TOptions, TResult> {
  (context: TContext, options?: TOptions): (model: TModel) => TResult;
  (model: TModel, context: TContext, options?: TOptions): TResult;
}

const isModelFirst = (args: ArrayLike<unknown>): boolean => {
  const first = args[0];
  return typeof first === "object" && first !== null && "api" in first;
};

export const modelCall = <TModel, TContext, TOptions, TResult>(
  call: (model: TModel, context: TContext, options?: TOptions) => TResult,
): ModelCall<TModel, TContext, TOptions, TResult> => Function.dual(isModelFirst, call);
