import { EventEmitter } from "node:events";

import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import childProcess from "../../../src/utils/child-process.ts";

const { waitForChildProcess } = childProcess;

class FakeStdout extends EventEmitter {
  write(chunk: string): void {
    this.emit("data", Buffer.from(chunk));
  }

  destroy(): void {
    this.removeAllListeners();
  }
}

interface FakeChild {
  readonly stdout: FakeStdout;
  readonly stderr: FakeStdout;
  emit(event: "exit", code: number, signal: string | null): boolean;
  on(event: "exit", listener: (code: number, signal: string | null) => void): void;
}

function createChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    stderr: new FakeStdout(),
    stdin: null,
    stdout: new FakeStdout(),
  });
}

const capturesOutputEmittedAfterExitWhile = Effect.gen(function* () {
  const child = createChild();
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  let resolved = false;
  const waiting = waitForChildProcess(
    child as unknown as Parameters<typeof waitForChildProcess>[0],
  ).then((exitCode) => {
    resolved = true;
    return exitCode;
  });

  child.stdout.write("HEAD\n");
  child.emit("exit", 0, null);
  for (let index = 1; index <= 6; index++) {
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(50));
    child.stdout.write(`TICK${index}\n`);
  }
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(99));
  expect(resolved).toBe(false);
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));

  expect(yield* Effect.promise(() => waiting)).toBe(0);
  expect(output).toContain("HEAD");
  expect(output).toContain("TICK6");
});

const resolvesAfterTheGraceWhenA = Effect.gen(function* () {
  const child = createChild();
  let resolved = false;
  const waiting = waitForChildProcess(
    child as unknown as Parameters<typeof waitForChildProcess>[0],
  ).then((exitCode) => {
    resolved = true;
    return exitCode;
  });

  child.stdout.write("DONE\n");
  child.emit("exit", 0, null);
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(99));
  expect(resolved).toBe(false);
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));

  expect(yield* Effect.promise(() => waiting)).toBe(0);
});

const capturesOutputEmittedAfterExitWhileA = () =>
  Effect.runPromise(capturesOutputEmittedAfterExitWhile);

const resolvesAfterTheGraceWhenADescendant = () => Effect.runPromise(resolvesAfterTheGraceWhenA);

describe("issue #5303 bash output truncation past exit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it(
    "captures output emitted after exit while a descendant holds stdout open",
    capturesOutputEmittedAfterExitWhileA,
  );
  it(
    "resolves after the grace when a descendant holds stdout open but stays quiet",
    resolvesAfterTheGraceWhenADescendant,
  );
});
