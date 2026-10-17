import { NodeRuntime } from "@effect/platform-node";
import { Effect, Function, Layer } from "effect";

export const runMainWith: {
  <ROut, E2>(layer: Layer.Layer<ROut, E2>): <A, E>(program: Effect.Effect<A, E, ROut>) => void;
  <A, E, ROut, E2>(program: Effect.Effect<A, E, ROut>, layer: Layer.Layer<ROut, E2>): void;
} = Function.dual(
  2,
  <A, E, ROut, E2>(program: Effect.Effect<A, E, ROut>, layer: Layer.Layer<ROut, E2>): void => {
    const main = Effect.scoped(
      Effect.flatMap(Layer.build(layer), (services) => Effect.provideContext(program, services)),
    );
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform runtime is pre-GA
    NodeRuntime.runMain(main);
  },
);
