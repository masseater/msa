import { access, chmod, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import {
  removeTempDir,
  chmodRestorePaths,
  tempDirs,
  createTempDir,
  fileHandlePrototype,
  abortedContext,
} from "./env-node-support.ts";

afterEach(async () => {
  vi.restoreAllMocks();
  for await (const path of chmodRestorePaths.splice(0)) {
    try {
      await access(path);
      await chmod(path, 0o700);
    } catch {}
  }
  for await (const dir of tempDirs.splice(0)) await removeTempDir(dir);
}, 15_000);

describe("NodeExecutionEnv filesystem", () => {
  it("returns aborted results without side effects for pre-aborted file operations", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("file.txt", "hello", BACKGROUND_CONTEXT));
    const context = abortedContext();

    const results = await Promise.all([
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
    ]);
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: "aborted" } });
    }
    expect(getOrThrow(await env.readTextFile("file.txt", BACKGROUND_CONTEXT))).toBe("hello");
    expect(
      getOrThrow(await env.listDir(".", BACKGROUND_CONTEXT)).map((entry) => entry.name),
    ).toEqual(["file.txt"]);
  });
});

describe("NodeExecutionEnv filesystem", () => {
  it("truncates and extends files to exact byte sizes", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const bytes = new Uint8Array([0x61, 0xc3, 0xa9, 0x0a, 0x62, 0x0a]);
    getOrThrow(await env.writeFile("file.bin", bytes, BACKGROUND_CONTEXT));

    // Truncation is byte-exact even when the boundary splits a UTF-8 sequence.
    getOrThrow(await env.truncateFile("file.bin", 2, BACKGROUND_CONTEXT));
    expect([...getOrThrow(await env.readBinaryFile("file.bin", BACKGROUND_CONTEXT))]).toEqual([
      0x61, 0xc3,
    ]);

    getOrThrow(await env.truncateFile("file.bin", 4, BACKGROUND_CONTEXT));
    expect([...getOrThrow(await env.readBinaryFile("file.bin", BACKGROUND_CONTEXT))]).toEqual([
      0x61, 0xc3, 0, 0,
    ]);

    getOrThrow(await env.truncateFile("file.bin", 0, BACKGROUND_CONTEXT));
    expect(getOrThrow(await env.fileInfo("file.bin", BACKGROUND_CONTEXT)).size).toBe(0);
  });

  it("rejects invalid truncation sizes and never creates missing files", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("file.txt", "hello", BACKGROUND_CONTEXT));
    for await (const size of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(await env.truncateFile("file.txt", size, BACKGROUND_CONTEXT)).toMatchObject({
        ok: false,
        error: { code: "invalid", path: join(root, "file.txt") },
      });
    }
    expect(getOrThrow(await env.readTextFile("file.txt", BACKGROUND_CONTEXT))).toBe("hello");

    expect(await env.truncateFile("missing.txt", 0, BACKGROUND_CONTEXT)).toMatchObject({
      ok: false,
      error: { code: "not_found", path: join(root, "missing.txt") },
    });
    expect(getOrThrow(await env.exists("missing.txt", BACKGROUND_CONTEXT))).toBe(false);
  });
});

describe("NodeExecutionEnv filesystem", () => {
  it("flushes existing files without changing content and reports missing paths", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("file.txt", "durable", BACKGROUND_CONTEXT));
    getOrThrow(await env.flushFile("file.txt", BACKGROUND_CONTEXT));
    expect(getOrThrow(await env.readTextFile("file.txt", BACKGROUND_CONTEXT))).toBe("durable");

    expect(await env.flushFile("missing.txt", BACKGROUND_CONTEXT)).toMatchObject({
      ok: false,
      error: { code: "not_found", path: join(root, "missing.txt") },
    });
    expect(getOrThrow(await env.exists("missing.txt", BACKGROUND_CONTEXT))).toBe(false);

    getOrThrow(await env.createDir("dir", undefined, BACKGROUND_CONTEXT));
    expect(await env.flushFile("dir", BACKGROUND_CONTEXT)).toMatchObject({
      ok: false,
      error: { code: "is_directory" },
    });
  });

  it("syncs through an opened handle, returns sync failures, and always closes the handle", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("file.txt", "durable", BACKGROUND_CONTEXT));
    const prototype = await fileHandlePrototype(join(root, "file.txt"));
    const originalSync = prototype.sync;
    const synced: FileHandle[] = [];
    const sync = vi.spyOn(prototype, "sync").mockImplementation(function (this: FileHandle) {
      synced.push(this);
      return Reflect.apply(originalSync, this, []);
    });

    getOrThrow(await env.flushFile("file.txt", BACKGROUND_CONTEXT));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(synced[0]?.fd).toBe(-1);

    sync.mockImplementationOnce(function (this: FileHandle) {
      synced.push(this);
      return Promise.reject(Object.assign(new Error("EIO: i/o error, fsync"), { code: "EIO" }));
    });
    expect(await env.flushFile("file.txt", BACKGROUND_CONTEXT)).toMatchObject({
      ok: false,
      error: { code: "unknown", path: join(root, "file.txt"), message: "EIO: i/o error, fsync" },
    });
    expect(sync).toHaveBeenCalledTimes(2);
    expect(synced[1]?.fd).toBe(-1);
  });
});

describe("NodeExecutionEnv filesystem", () => {
  it("cleanup is best-effort", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await expect(env.cleanup(BACKGROUND_CONTEXT)).resolves.toBeUndefined();
  });
});

describe("NodeExecutionEnv text line reader", () => {
  it("reports whether each line was newline-terminated and preserves carriage returns", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("lines.txt", "one\r\n\ntwo\npartial", BACKGROUND_CONTEXT));
    const reader = getOrThrow(await env.openTextLineReader("lines.txt", BACKGROUND_CONTEXT));
    try {
      const lines: unknown[] = [];
      const readAll = async (): Promise<void> => {
        const line = getOrThrow(await reader.readLine(BACKGROUND_CONTEXT));
        if (line === undefined) return;
        lines.push(line);
        await readAll();
      };
      await readAll();
      expect(lines).toEqual([
        { text: "one\r", terminated: true },
        { text: "", terminated: true },
        { text: "two", terminated: true },
        { text: "partial", terminated: false },
      ]);
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toBeUndefined();
    } finally {
      await reader.close(BACKGROUND_CONTEXT);
    }
  });

  it("returns no lines for an empty file and one terminated empty line for a lone newline", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("empty.txt", "", BACKGROUND_CONTEXT));
    getOrThrow(await env.writeFile("newline.txt", "\n", BACKGROUND_CONTEXT));

    const empty = getOrThrow(await env.openTextLineReader("empty.txt", BACKGROUND_CONTEXT));
    expect(getOrThrow(await empty.readLine(BACKGROUND_CONTEXT))).toBeUndefined();
    await empty.close(BACKGROUND_CONTEXT);

    const newline = getOrThrow(await env.openTextLineReader("newline.txt", BACKGROUND_CONTEXT));
    expect(getOrThrow(await newline.readLine(BACKGROUND_CONTEXT))).toEqual({
      text: "",
      terminated: true,
    });
    expect(getOrThrow(await newline.readLine(BACKGROUND_CONTEXT))).toBeUndefined();
    await newline.close(BACKGROUND_CONTEXT);
  });
});

describe("NodeExecutionEnv text line reader", () => {
  it("decodes multi-byte characters split across read chunks and lines longer than one chunk", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    // The reader uses 64 KiB chunks; place a four-byte character across the first boundary.
    const first = `${"a".repeat(64 * 1024 - 2)}😀tail`;
    const second = "é".repeat(100_000);
    getOrThrow(await env.writeFile("large.txt", `${first}\n${second}`, BACKGROUND_CONTEXT));
    const reader = getOrThrow(await env.openTextLineReader("large.txt", BACKGROUND_CONTEXT));
    try {
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toEqual({
        text: first,
        terminated: true,
      });
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toEqual({
        text: second,
        terminated: false,
      });
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toBeUndefined();
    } finally {
      await reader.close(BACKGROUND_CONTEXT);
    }
  });
});

describe("NodeExecutionEnv text line reader", () => {
  it("rejects a read cancelled while pending without consuming its bytes", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("lines.txt", "one\ntwo\n", BACKGROUND_CONTEXT));
    const prototype = await fileHandlePrototype(join(root, "lines.txt"));
    const read = prototype.read;
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(prototype, "read").mockImplementationOnce(async function (
      this: FileHandle,
      ...args: unknown[]
    ) {
      markStarted();
      await gate;
      return Reflect.apply(read, this, args);
    } as unknown as FileHandle["read"]);

    const reader = getOrThrow(await env.openTextLineReader("lines.txt", BACKGROUND_CONTEXT));
    try {
      const controller = new AbortController();
      const pending = reader.readLine(withAbortSignal(controller.signal, BACKGROUND_CONTEXT));
      await started;
      controller.abort();
      release();
      expect(await pending).toMatchObject({ ok: false, error: { code: "aborted" } });
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toEqual({
        text: "one",
        terminated: true,
      });
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toEqual({
        text: "two",
        terminated: true,
      });
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toBeUndefined();
    } finally {
      await reader.close(BACKGROUND_CONTEXT);
    }
  });
});
