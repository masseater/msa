import { type FileHandle } from "node:fs/promises";

import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { abortController, awaited } from "./effect-support.ts";
import { cleanUpEnvTests, createTempDir, fileHandlePrototype } from "./env-node-support.ts";
import { joinPath } from "./platform-support.ts";

afterEach(() => Effect.runPromise(cleanUpEnvTests), 15_000);

const decodesMultiByte = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const first = `${"a".repeat(64 * 1024 - 2)}😀tail`;
  const second = "é".repeat(100_000);
  getOrThrow(yield* awaited(env.writeFile("large.txt", `${first}\n${second}`, BACKGROUND_CONTEXT)));
  const reader = getOrThrow(
    yield* awaited(env.openTextLineReader("large.txt", BACKGROUND_CONTEXT)),
  );
  yield* Effect.gen(function* () {
    expect(getOrThrow(yield* awaited(reader.readLine(BACKGROUND_CONTEXT)))).toEqual({
      text: first,
      terminated: true,
    });
    expect(getOrThrow(yield* awaited(reader.readLine(BACKGROUND_CONTEXT)))).toEqual({
      text: second,
      terminated: false,
    });
    expect(getOrThrow(yield* awaited(reader.readLine(BACKGROUND_CONTEXT)))).toBeUndefined();
  }).pipe(Effect.ensuring(Effect.suspend(() => awaited(reader.close(BACKGROUND_CONTEXT)))));
});

describe("NodeExecutionEnv text line reader", () => {
  it("decodes multi-byte characters split across read chunks and lines longer than one chunk", () =>
    Effect.runPromise(decodesMultiByte));
});

const rejectsReadCancelled = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile("lines.txt", "one\ntwo\n", BACKGROUND_CONTEXT)));
  const prototype = yield* fileHandlePrototype(joinPath(root, "lines.txt"));
  const read = prototype.read;
  const { promise: started, resolve: markStarted } = Promise.withResolvers<void>();
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
  vi.spyOn(prototype, "read").mockImplementationOnce(function (
    this: FileHandle,
    ...args: unknown[]
  ) {
    return runPromise(
      Effect.gen({ self: this }, function* () {
        markStarted();
        yield* awaited(gate);
        return Reflect.apply(read, this, args);
      }),
    );
  } as unknown as FileHandle["read"]);

  const reader = getOrThrow(
    yield* awaited(env.openTextLineReader("lines.txt", BACKGROUND_CONTEXT)),
  );
  yield* Effect.gen(function* () {
    const controller = abortController();
    const pending = reader.readLine(withAbortSignal(controller.signal, BACKGROUND_CONTEXT));
    yield* awaited(started);
    controller.abort();
    release();
    expect(yield* awaited(pending)).toMatchObject({ ok: false, error: { code: "aborted" } });
    expect(getOrThrow(yield* awaited(reader.readLine(BACKGROUND_CONTEXT)))).toEqual({
      text: "one",
      terminated: true,
    });
    expect(getOrThrow(yield* awaited(reader.readLine(BACKGROUND_CONTEXT)))).toEqual({
      text: "two",
      terminated: true,
    });
    expect(getOrThrow(yield* awaited(reader.readLine(BACKGROUND_CONTEXT)))).toBeUndefined();
  }).pipe(Effect.ensuring(Effect.suspend(() => awaited(reader.close(BACKGROUND_CONTEXT)))));
});

describe("NodeExecutionEnv text line reader", () => {
  it("rejects a read cancelled while pending without consuming its bytes", () =>
    Effect.runPromise(rejectsReadCancelled));
});
