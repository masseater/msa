declare namespace modelCallTypes {
  interface ModelCall<TModel, TContext, TOptions, TResult> {
    (context: TContext, options?: TOptions): (model: TModel) => TResult;
    (model: TModel, context: TContext, options?: TOptions): TResult;
  }
}

export type { modelCallTypes as default };
