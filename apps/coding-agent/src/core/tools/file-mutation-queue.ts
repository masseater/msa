import { Deferred, Effect, FileSystem, Semaphore } from "effect";
import { dual } from "effect/Function";

import platform from "../platform/index.ts";
import nodeRuntime from "../platform/runtime.ts";

const { isMissingPath } = platform;

const fileMutationQueues = new Map<string, Deferred.Deferred<void>>();
const registration = Semaphore.makeUnsafe(1);

const mutationQueueKey = (filePath: string) => {
  const resolvedPath = platform.resolve(filePath);
  return FileSystem.FileSystem.use((fs) => fs.realPath(resolvedPath)).pipe(
    Effect.catch((error) =>
      isMissingPath(error) ? Effect.succeed(resolvedPath) : Effect.die(error),
    ),
  );
};

const enqueue = (filePath: string) =>
  registration.withPermits(1)(
    Effect.gen(function* () {
      const key = yield* mutationQueueKey(filePath);
      const previous = fileMutationQueues.get(key);
      const next = yield* Deferred.make<void>();
      fileMutationQueues.set(key, next);
      return { key, next, previous };
    }),
  );

const withMutationQueue = Effect.fn("withFileMutationQueue")(function* <A>(
  filePath: string,
  run: () => Promise<A>,
) {
  const { key, previous, next } = yield* enqueue(filePath);
  if (previous !== undefined) yield* Deferred.await(previous);
  return yield* Effect.promise(run).pipe(
    Effect.ensuring(
      Effect.suspend(() => {
        if (fileMutationQueues.get(key) === next) fileMutationQueues.delete(key);
        return Deferred.succeed(next, undefined);
      }),
    ),
  );
});

const withFileMutationQueue: {
  <T>(fn: () => Promise<T>): (filePath: string) => Promise<T>;
  <T>(filePath: string, fn: () => Promise<T>): Promise<T>;
} = dual(2, <T>(filePath: string, fn: () => Promise<T>): Promise<T> =>
  nodeRuntime.runPromise(withMutationQueue(filePath, fn)),
);

const fileMutationQueue = {
  withFileMutationQueue,
};

export default fileMutationQueue;
