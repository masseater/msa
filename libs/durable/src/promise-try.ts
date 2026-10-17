import { Effect } from "effect";

export const promiseTry = <T>(run: () => T | PromiseLike<T>): Promise<T> =>
  Effect.runPromise(Effect.promise(() => Promise.resolve(run())));
