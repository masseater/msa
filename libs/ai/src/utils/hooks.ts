import { Effect } from "effect";

export const callHook = <A>(hook: () => A | PromiseLike<A>): Effect.Effect<Awaited<A>> =>
  Effect.promise(() => Promise.resolve(hook()));
