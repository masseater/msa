import { Effect, Semaphore } from "effect";

import { type FileWrite, Platform, platformRuntime } from "./platform.ts";

const writeLock = Semaphore.makeUnsafe(1);

export function writeFileInBackground(
  file: Effect.Effect<FileWrite | undefined, never, Platform>,
): void {
  const write = Effect.gen(function* () {
    const request = yield* file;
    if (request === undefined) return;
    const platform = yield* Platform;
    yield* platform.writeFile(request);
  });
  platformRuntime.runFork(Semaphore.withPermit(writeLock)(write).pipe(Effect.ignore));
}

export function flushBackgroundFileWrites(): Promise<void> {
  return platformRuntime.runPromise(Semaphore.withPermit(writeLock)(Effect.void));
}
