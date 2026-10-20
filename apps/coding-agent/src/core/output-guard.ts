import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";

const { awaited, awaiting, performed } = awaitingModule;
interface StdoutTakeoverState {
  rawStdoutWrite: (chunk: string, callback?: (error?: Error | null) => void) => boolean;
  rawStderrWrite: (chunk: string, callback?: (error?: Error | null) => void) => boolean;
  originalStdoutWrite: typeof process.stdout.write;
}

let stdoutTakeoverState: StdoutTakeoverState | undefined;

const RAW_STDOUT_RETRY_DELAY_MS = 10;

let rawStdoutWriteTail: Promise<void> = Promise.resolve();

function getRawStdoutWrite(): StdoutTakeoverState["rawStdoutWrite"] {
  if (stdoutTakeoverState !== undefined) {
    return stdoutTakeoverState.rawStdoutWrite;
  }
  return process.stdout.write.bind(process.stdout) as StdoutTakeoverState["rawStdoutWrite"];
}

function writeRawStdoutChunk(text: string): Effect.Effect<void> {
  return awaiting(function* () {
    while (true) {
      try {
        yield* performed(
          Effect.callback<void>((resume) => {
            try {
              getRawStdoutWrite()(text, (error) => {
                if (error !== undefined && error !== null) resume(Effect.die(error));
                else resume(Effect.void);
              });
            } catch (error) {
              resume(Effect.die(error instanceof Error ? error : new Error(String(error))));
            }
          }),
        );
        return;
      } catch (error) {
        const writeError = error instanceof Error ? error : new Error(String(error));
        const code = (writeError as Error & { code?: unknown }).code;
        if (code !== "ENOBUFS" && code !== "EAGAIN" && code !== "EWOULDBLOCK") {
          throw writeError;
        }
        yield* performed(Effect.sleep(RAW_STDOUT_RETRY_DELAY_MS));
      }
    }
  });
}

function takeOverStdout(): void {
  if (stdoutTakeoverState !== undefined) {
    return;
  }

  const rawStdoutWrite = process.stdout.write.bind(
    process.stdout,
  ) as StdoutTakeoverState["rawStdoutWrite"];
  const rawStderrWrite = process.stderr.write.bind(
    process.stderr,
  ) as StdoutTakeoverState["rawStderrWrite"];
  const originalStdoutWrite = process.stdout.write;

  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    if (typeof encodingOrCallback === "function") {
      return rawStderrWrite(String(chunk), encodingOrCallback);
    }
    return rawStderrWrite(String(chunk), callback);
  }) as typeof process.stdout.write;

  stdoutTakeoverState = {
    originalStdoutWrite,
    rawStderrWrite,
    rawStdoutWrite,
  };
}

function restoreStdout(): void {
  if (stdoutTakeoverState === undefined) {
    return;
  }

  process.stdout.write = stdoutTakeoverState.originalStdoutWrite;
  stdoutTakeoverState = undefined;
}

function isStdoutTakenOver(): boolean {
  return stdoutTakeoverState !== undefined;
}

function writeRawStdout(text: string): void {
  if (text.length === 0) {
    return;
  }
  rawStdoutWriteTail = rawStdoutWriteTail.then(() => Effect.runPromise(writeRawStdoutChunk(text)));
  void rawStdoutWriteTail.catch(() => {
    process.exit(1);
  });
}

function waitForRawStdoutBackpressure(): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      while (true) {
        const tail = rawStdoutWriteTail;
        yield* awaited(tail);
        if (tail === rawStdoutWriteTail) {
          return;
        }
      }
    }),
  );
}

function flushRawStdout(): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      yield* awaited(waitForRawStdoutBackpressure());
      yield* performed(writeRawStdoutChunk(""));
    }),
  );
}

const outputGuard = {
  flushRawStdout,
  isStdoutTakenOver,
  restoreStdout,
  takeOverStdout,
  waitForRawStdoutBackpressure,
  writeRawStdout,
};

export default outputGuard;
