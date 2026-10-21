import { Effect } from "effect";

const callHook = <A>(hook: () => A | PromiseLike<A>): Effect.Effect<Awaited<A>> =>
  Effect.promise(() => Promise.resolve(hook()));

const hooks = {
  callHook,
};

export default hooks;
