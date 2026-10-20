import { Effect, Semaphore } from "effect";

import platformModule from "./platform.ts";
import type platformTypes from "./platform.types.ts";

const { Platform, platformRuntime } = platformModule;

const writeLock = Semaphore.makeUnsafe(1);

function writeFileInBackground(
  file: Effect.Effect<platformTypes.FileWrite | undefined, never, platformTypes.Platform>,
): void {
  const write = Effect.gen(function* () {
    const request = yield* file;
    if (request === undefined) return;
    const platform = yield* Platform;
    yield* platform.writeFile(request);
  });
  platformRuntime.runFork(Semaphore.withPermit(writeLock)(write).pipe(Effect.ignore));
}

function flushBackgroundFileWrites(): Promise<void> {
  return platformRuntime.runPromise(Semaphore.withPermit(writeLock)(Effect.void));
}

const fileLog = {
  flushBackgroundFileWrites,
  writeFileInBackground,
};

export default fileLog;
