import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, ManagedRuntime } from "effect";

const testRuntime = ManagedRuntime.make(NodeServices.layer);

const runTest = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => testRuntime.runPromise(effect);

const runTestSync = <A, E>(effect: Effect.Effect<A, E>): A => testRuntime.runSync(effect);

const provideNode = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E> =>
  Effect.flatMap(testRuntime.contextEffect, (context) =>
    Effect.provideContext(effect, context),
  ) as unknown as Effect.Effect<A, E>;

const runtime = {
  provideNode,
  runTest,
  runTestSync,
};

export default runtime;
