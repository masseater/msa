import { Effect, Function } from "effect";

import ModelsError from "./models-error-class.ts";
import type modelsErrorTypes from "./models-error.types.ts";

const promiseOrModelsError: {
  (spec: modelsErrorTypes.ModelsErrorSpec): <A>(run: () => Promise<A>) => Effect.Effect<A>;
  <A>(run: () => Promise<A>, spec: modelsErrorTypes.ModelsErrorSpec): Effect.Effect<A>;
} = Function.dual(
  2,
  <A>(run: () => Promise<A>, spec: modelsErrorTypes.ModelsErrorSpec): Effect.Effect<A> =>
    Effect.promise(() => run()).pipe(
      Effect.catchDefect((cause) =>
        Effect.die(ModelsError.create(spec.code, spec.message, { cause })),
      ),
    ),
);

const modelsError = {
  ModelsError,
  promiseOrModelsError,
};

export default modelsError;
