import { Effect } from "effect";

import type credentialStoreTypes from "./credential-store.types.ts";
import InMemoryCredentialStore from "./in-memory-credential-store.ts";

const runAfterPrevious = <K, A>({
  chains,
  key,
  task,
}: credentialStoreTypes.SerialTask<K, A>): Promise<A> => {
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

const credentialStore = {
  InMemoryCredentialStore,
  runAfterPrevious,
};

export default credentialStore;
