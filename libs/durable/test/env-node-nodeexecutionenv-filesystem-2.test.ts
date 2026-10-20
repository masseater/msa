import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import effectSupport from "./effect-support.ts";
import envNodeSupport from "./env-node-support.ts";
import type envNodeSupportTypes from "./env-node-support.types.ts";
import platformSupport from "./platform-support.ts";

vi.mock("node:fs/promises", (importOriginal) =>
  Promise.all([
    importOriginal<{ readonly open: unknown }>(),
    import("./node-fs-promises-capture.ts"),
  ]).then(([actual, capture]) => capture.default.captureFsPromises(actual)),
);

const { abortController, awaited } = effectSupport;
const { cleanUpEnvTests, createTempDir, fileHandlePrototype } = envNodeSupport;
const { joinPath } = platformSupport;

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
      terminated: true,
      text: first,
    });
    expect(getOrThrow(yield* awaited(reader.readLine(BACKGROUND_CONTEXT)))).toEqual({
      terminated: false,
      text: second,
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
    this: envNodeSupportTypes.NodeFileHandle,
    ...args: unknown[]
  ) {
    return runPromise(
      Effect.gen({ self: this }, function* () {
        markStarted();
        yield* awaited(gate);
        return yield* awaited(Reflect.apply(read, this, args));
      }),
    );
  } as unknown as envNodeSupportTypes.NodeFileHandle["read"]);

  const reader = getOrThrow(
    yield* awaited(env.openTextLineReader("lines.txt", BACKGROUND_CONTEXT)),
  );
  yield* Effect.gen(function* () {
    const controller = abortController();
    const pending = reader.readLine(withAbortSignal(controller.signal, BACKGROUND_CONTEXT));
    yield* awaited(started);
    controller.abort();
    release();
    expect(yield* awaited(pending)).toMatchObject({ error: { code: "aborted" }, ok: false });
    expect(getOrThrow(yield* awaited(reader.readLine(BACKGROUND_CONTEXT)))).toEqual({
      terminated: true,
      text: "one",
    });
    expect(getOrThrow(yield* awaited(reader.readLine(BACKGROUND_CONTEXT)))).toEqual({
      terminated: true,
      text: "two",
    });
    expect(getOrThrow(yield* awaited(reader.readLine(BACKGROUND_CONTEXT)))).toBeUndefined();
  }).pipe(Effect.ensuring(Effect.suspend(() => awaited(reader.close(BACKGROUND_CONTEXT)))));
});

describe("NodeExecutionEnv text line reader", () => {
  it("rejects a read cancelled while pending without consuming its bytes", () =>
    Effect.runPromise(rejectsReadCancelled));
});
