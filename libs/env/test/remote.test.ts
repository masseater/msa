import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import envModule from "@msa/durable/env";
import type envTypes from "@msa/durable/env.types";
import { Clock, Effect, Exit, Scope } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import platform from "./platform.ts";
import remoteEnvironments from "./remote-environment.ts";

const { getOrThrow } = envModule;

const { localPath, makeDirectory, writeText } = platform;

const context = BACKGROUND_CONTEXT;
const environments = remoteEnvironments();
afterAll(environments.close);
const { environment } = environments;

const run = (effect: Effect.Effect<void>): Promise<void> => Effect.runPromise(effect);

const windowedOutput = Effect.gen(function* () {
  const { env } = yield* environment;
  const total = 5_000_000;
  let delivered = 0;
  let skipped = 0;
  let tail = "";
  const result = yield* Effect.promise(() =>
    env.exec(
      ["sh", "-c", `yes 0123456789abcdef | head -c ${total}`],
      {
        onOutput: (text: string, _context, info: envTypes.ShellOutputInfo) => {
          delivered += Buffer.byteLength(text);
          if (info.skipped !== undefined) {
            skipped += info.skipped.bytes;
            tail = "";
          }
          tail += text;
        },
        window: { bytesPerSecond: 1_000_000, maxBytes: 1000, maxLines: 20, minIntervalMs: 20 },
      },
      context,
    ),
  );
  expect(getOrThrow(result).exitCode).toBe(0);
  expect(delivered + skipped).toBe(total);
  expect(skipped).toBeGreaterThan(0);
  expect(delivered).toBeLessThan(total / 10);
  const full = "0123456789abcdef\n".repeat(Math.ceil(total / 17)).slice(0, total);
  expect(full.endsWith(tail)).toBe(true);
  expect(tail.length > 1000 || tail.split("\n").length - 1 > 20).toBe(true);
});

const abortRightAfterSend = Effect.gen(function* () {
  const { env } = yield* environment;
  const started = yield* Clock.currentTimeMillis;
  for (let attempt = 0; attempt < 20; attempt++) {
    const scope = yield* Scope.make();
    const signal = yield* Scope.provide(Effect.abortSignal, scope);
    const running = env.exec(["sleep", "5"], undefined, withAbortSignal(signal, context));
    const abort = Scope.close(scope, Exit.void);
    if (attempt % 2 === 0) yield* abort;
    else yield* Effect.forkChild(Effect.delay(abort, attempt % 5));
    const result = yield* Effect.promise(() => running);
    expect(result.ok ? "ok" : result.error.code).toBe("aborted");
  }
  expect((yield* Clock.currentTimeMillis) - started).toBeLessThan(10_000);
});

const cancelListing = Effect.gen(function* () {
  const { env, connection } = yield* environment;
  for (let dir = 0; dir < 100; dir++) {
    yield* makeDirectory(localPath.join(env.cwd, `d${dir}`));
    for (let file = 0; file < 100; file++) {
      yield* writeText({ path: localPath.join(env.cwd, `d${dir}`, `f${file}`), text: "" });
    }
  }
  const cancelled = connection.request(
    "listFiles",
    { path: env.cwd },
    { signal: AbortSignal.abort() },
  );
  yield* Effect.promise(() => expect(cancelled).rejects.toMatchObject({ code: "aborted" }));
  const listed = getOrThrow(yield* Effect.promise(() => env.listFiles(".", undefined, context)));
  expect([listed.entries.length, listed.truncated]).toEqual([10_100, false]);
  const bounded = getOrThrow(
    yield* Effect.promise(() => env.listFiles(".", { maxEntries: 5000 }, context)),
  );
  expect([bounded.entries.length, bounded.truncated]).toEqual([5000, true]);
});

const silentTimeout = Effect.gen(function* () {
  const { env } = yield* environment;
  const started = yield* Clock.currentTimeMillis;
  const result = yield* Effect.promise(() => env.exec(["sleep", "5"], { timeout: 0.3 }, context));
  expect(result.ok ? "ok" : result.error.code).toBe("timeout");
  expect((yield* Clock.currentTimeMillis) - started).toBeLessThan(3000);
});

const sameBytes = (left: Uint8Array, right: Uint8Array): number =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));

const largeFiles = Effect.gen(function* () {
  const { env } = yield* environment;
  const content = new Uint8Array(3_500_017);
  for (let index = 0; index < content.length; index++) content[index] = (index * 7919) % 251;
  getOrThrow(yield* Effect.promise(() => env.writeFile("big.bin", content, context)));
  getOrThrow(yield* Effect.promise(() => env.appendFile("big.bin", content, context)));
  const read = getOrThrow(yield* Effect.promise(() => env.readBinaryFile("big.bin", context)));
  expect(read.length).toBe(content.length * 2);
  expect(sameBytes(read.subarray(0, content.length), content)).toBe(0);
  expect(sameBytes(read.subarray(content.length), content)).toBe(0);
  const reader = getOrThrow(
    yield* Effect.promise(() => env.openBinaryReader("big.bin", undefined, context)),
  );
  const range = getOrThrow(yield* Effect.promise(() => reader.read(1_000_003, 2_000_000, context)));
  yield* Effect.promise(() => reader.close(context));
  expect(sameBytes(range, read.subarray(1_000_003, 3_000_003))).toBe(0);
});

describe("RemoteExecutionEnv", () => {
  it(
    "transfers only about a window of output a caller keeps, with exact counts",
    () => run(windowedOutput),
    60_000,
  );
  it("aborts commands cancelled right after they are sent", () => run(abortRightAfterSend), 30_000);
  it("cancels a listing in the daemon", () => run(cancelListing), 30_000);
  it("times out a command that produces no output", () => run(silentTimeout));
  it(
    "writes and reads files larger than one transfer chunk in order",
    () => run(largeFiles),
    60_000,
  );
});
