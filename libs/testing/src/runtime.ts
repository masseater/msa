import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime } from "effect";

const testRuntime = ManagedRuntime.make(
  Layer.merge(NodeServices.layer, NodeCrypto.layerSecureRandom),
);

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
