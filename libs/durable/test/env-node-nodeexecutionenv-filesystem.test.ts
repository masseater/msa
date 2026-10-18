import { type FileHandle } from "node:fs/promises";

import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { abortController, awaited } from "./effect-support.ts";
import {
  cleanUpEnvTests,
  createTempDir,
  fileHandlePrototype,
  abortedContext,
} from "./env-node-support.ts";
import { joinPath } from "./platform-support.ts";

afterEach(() => Effect.runPromise(cleanUpEnvTests), 15_000);

const returnsAbortedResults = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile("file.txt", "hello", BACKGROUND_CONTEXT)));
  const context = abortedContext();

  const results = yield* awaited(
    Promise.all([
      env.readTextFile("file.txt", context),
      env.readTextLines("file.txt", undefined, context),
      env.readBinaryFile("file.txt", context),
      env.openTextLineReader("file.txt", context),
      env.writeFile("other.txt", "hello", context),
      env.appendFile("file.txt", " world", context),
      env.truncateFile("file.txt", 1, context),
      env.flushFile("file.txt", context),
      env.renameFile("file.txt", "renamed.txt", context),
      env.fileInfo("file.txt", context),
      env.listDir(".", context),
      env.canonicalPath("file.txt", context),
      env.exists("file.txt", context),
      env.createDir("dir", undefined, context),
      env.remove("file.txt", undefined, context),
      env.createTempDir(undefined, context),
      env.createTempFile(undefined, context),
    ]),
  );
  for (const result of results) {
    expect(result).toMatchObject({ ok: false, error: { code: "aborted" } });
  }
  expect(getOrThrow(yield* awaited(env.readTextFile("file.txt", BACKGROUND_CONTEXT)))).toBe(
    "hello",
  );
  expect(
    getOrThrow(yield* awaited(env.listDir(".", BACKGROUND_CONTEXT))).map((entry) => entry.name),
  ).toEqual(["file.txt"]);
});

describe("NodeExecutionEnv filesystem", () => {
  it("returns aborted results without side effects for pre-aborted file operations", () =>
    Effect.runPromise(returnsAbortedResults));
});

const truncatesExtendsFiles = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const bytes = new Uint8Array([0x61, 0xc3, 0xa9, 0x0a, 0x62, 0x0a]);
  getOrThrow(yield* awaited(env.writeFile("file.bin", bytes, BACKGROUND_CONTEXT)));

  getOrThrow(yield* awaited(env.truncateFile("file.bin", 2, BACKGROUND_CONTEXT)));
  expect([
    ...getOrThrow(yield* awaited(env.readBinaryFile("file.bin", BACKGROUND_CONTEXT))),
  ]).toEqual([0x61, 0xc3]);

  getOrThrow(yield* awaited(env.truncateFile("file.bin", 4, BACKGROUND_CONTEXT)));
  expect([
    ...getOrThrow(yield* awaited(env.readBinaryFile("file.bin", BACKGROUND_CONTEXT))),
  ]).toEqual([0x61, 0xc3, 0, 0]);

  getOrThrow(yield* awaited(env.truncateFile("file.bin", 0, BACKGROUND_CONTEXT)));
  expect(getOrThrow(yield* awaited(env.fileInfo("file.bin", BACKGROUND_CONTEXT))).size).toBe(0);
});

const rejectsInvalidTruncation = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile("file.txt", "hello", BACKGROUND_CONTEXT)));
  for (const size of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    expect(yield* awaited(env.truncateFile("file.txt", size, BACKGROUND_CONTEXT))).toMatchObject({
      ok: false,
      error: { code: "invalid", path: joinPath(root, "file.txt") },
    });
  }
  expect(getOrThrow(yield* awaited(env.readTextFile("file.txt", BACKGROUND_CONTEXT)))).toBe(
    "hello",
  );

  expect(yield* awaited(env.truncateFile("missing.txt", 0, BACKGROUND_CONTEXT))).toMatchObject({
    ok: false,
    error: { code: "not_found", path: joinPath(root, "missing.txt") },
  });
  expect(getOrThrow(yield* awaited(env.exists("missing.txt", BACKGROUND_CONTEXT)))).toBe(false);
});

describe("NodeExecutionEnv filesystem", () => {
  it("truncates and extends files to exact byte sizes", () =>
    Effect.runPromise(truncatesExtendsFiles));

  it("rejects invalid truncation sizes and never creates missing files", () =>
    Effect.runPromise(rejectsInvalidTruncation));
});

const flushesExistingFiles = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile("file.txt", "durable", BACKGROUND_CONTEXT)));
  getOrThrow(yield* awaited(env.flushFile("file.txt", BACKGROUND_CONTEXT)));
  expect(getOrThrow(yield* awaited(env.readTextFile("file.txt", BACKGROUND_CONTEXT)))).toBe(
    "durable",
  );

  expect(yield* awaited(env.flushFile("missing.txt", BACKGROUND_CONTEXT))).toMatchObject({
    ok: false,
    error: { code: "not_found", path: joinPath(root, "missing.txt") },
  });
  expect(getOrThrow(yield* awaited(env.exists("missing.txt", BACKGROUND_CONTEXT)))).toBe(false);

  getOrThrow(yield* awaited(env.createDir("dir", undefined, BACKGROUND_CONTEXT)));
  expect(yield* awaited(env.flushFile("dir", BACKGROUND_CONTEXT))).toMatchObject({
    ok: false,
    error: { code: "is_directory" },
  });
});

const syncsThroughOpened = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile("file.txt", "durable", BACKGROUND_CONTEXT)));
  const prototype = yield* fileHandlePrototype(joinPath(root, "file.txt"));
  const originalSync = prototype.sync;
  const synced: FileHandle[] = [];
  const sync = vi.spyOn(prototype, "sync").mockImplementation(function (this: FileHandle) {
    synced.push(this);
    return Reflect.apply(originalSync, this, []);
  });

  getOrThrow(yield* awaited(env.flushFile("file.txt", BACKGROUND_CONTEXT)));
  expect(sync).toHaveBeenCalledTimes(1);
  expect(synced[0]?.fd).toBe(-1);

  sync.mockImplementationOnce(function (this: FileHandle) {
    synced.push(this);
    return Promise.reject(Object.assign(new Error("EIO: i/o error, fsync"), { code: "EIO" }));
  });
  expect(yield* awaited(env.flushFile("file.txt", BACKGROUND_CONTEXT))).toMatchObject({
    ok: false,
    error: {
      code: "unknown",
      path: joinPath(root, "file.txt"),
      message: "EIO: i/o error, fsync",
    },
  });
  expect(sync).toHaveBeenCalledTimes(2);
  expect(synced[1]?.fd).toBe(-1);
});

describe("NodeExecutionEnv filesystem", () => {
  it("flushes existing files without changing content and reports missing paths", () =>
    Effect.runPromise(flushesExistingFiles));

  it("syncs through an opened handle, returns sync failures, and always closes the handle", () =>
    Effect.runPromise(syncsThroughOpened));
});

const cleanupBestEffort = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  yield* awaited(expect(env.cleanup(BACKGROUND_CONTEXT)).resolves.toBeUndefined());
});

describe("NodeExecutionEnv filesystem", () => {
  it("cleanup is best-effort", () => Effect.runPromise(cleanupBestEffort));
});

const reportsWhetherEach = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(
    yield* awaited(env.writeFile("lines.txt", "one\r\n\ntwo\npartial", BACKGROUND_CONTEXT)),
  );
  const reader = getOrThrow(
    yield* awaited(env.openTextLineReader("lines.txt", BACKGROUND_CONTEXT)),
  );
  yield* Effect.gen(function* () {
    const lines: unknown[] = [];
    const readAll = (): Promise<void> =>
      runPromise(
        Effect.gen(function* () {
          const line = getOrThrow(yield* awaited(reader.readLine(BACKGROUND_CONTEXT)));
          if (line === undefined) return;
          lines.push(line);
          yield* awaited(readAll());
        }),
      );
    yield* awaited(readAll());
    expect(lines).toEqual([
      { text: "one\r", terminated: true },
      { text: "", terminated: true },
      { text: "two", terminated: true },
      { text: "partial", terminated: false },
    ]);
    expect(getOrThrow(yield* awaited(reader.readLine(BACKGROUND_CONTEXT)))).toBeUndefined();
  }).pipe(
    Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(reader.close(BACKGROUND_CONTEXT))))),
  );
});

const returnsNoLines = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile("empty.txt", "", BACKGROUND_CONTEXT)));
  getOrThrow(yield* awaited(env.writeFile("newline.txt", "\n", BACKGROUND_CONTEXT)));

  const empty = getOrThrow(yield* awaited(env.openTextLineReader("empty.txt", BACKGROUND_CONTEXT)));
  expect(getOrThrow(yield* awaited(empty.readLine(BACKGROUND_CONTEXT)))).toBeUndefined();
  yield* awaited(empty.close(BACKGROUND_CONTEXT));

  const newline = getOrThrow(
    yield* awaited(env.openTextLineReader("newline.txt", BACKGROUND_CONTEXT)),
  );
  expect(getOrThrow(yield* awaited(newline.readLine(BACKGROUND_CONTEXT)))).toEqual({
    text: "",
    terminated: true,
  });
  expect(getOrThrow(yield* awaited(newline.readLine(BACKGROUND_CONTEXT)))).toBeUndefined();
  yield* awaited(newline.close(BACKGROUND_CONTEXT));
});

describe("NodeExecutionEnv text line reader", () => {
  it("reports whether each line was newline-terminated and preserves carriage returns", () =>
    Effect.runPromise(reportsWhetherEach));

  it("returns no lines for an empty file and one terminated empty line for a lone newline", () =>
    Effect.runPromise(returnsNoLines));
});

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
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
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
