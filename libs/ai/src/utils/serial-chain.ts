import { Effect } from "effect";

export interface SerialTask<K, A> {
  readonly chains: Map<K, Promise<unknown>>;
  readonly key: K;
  readonly task: Effect.Effect<A>;
}

export const runAfterPrevious = <K, A>({ chains, key, task }: SerialTask<K, A>): Promise<A> => {
  const previous = chains.get(key) ?? Promise.resolve();
  const queued = Effect.runPromise(
    Effect.promise(() => previous.catch(() => {})).pipe(Effect.andThen(task)),
  );
  const tail = queued.catch(() => {});
  chains.set(key, tail);
  Effect.runFork(
    Effect.promise(() => tail).pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (chains.get(key) === tail) chains.delete(key);
        }),
      ),
    ),
  );
  return queued;
};
