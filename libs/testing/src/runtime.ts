import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, ManagedRuntime } from "effect";

export const testRuntime = ManagedRuntime.make(NodeServices.layer);

export const runTest = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  testRuntime.runPromise(effect);

export const provideNode = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E> =>
  Effect.flatMap(testRuntime.contextEffect, (context) =>
    Effect.provideContext(effect, context),
  ) as unknown as Effect.Effect<A, E>;
