import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

import contextModule from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import envModule from "../src/env/index.ts";
import node from "../src/env/node.ts";
import effectSupport from "./effect-support.ts";
import envNodeSupport from "./env-node-support.ts";
import platformSupport from "./platform-support.ts";

const { BACKGROUND_CONTEXT } = contextModule;
const { NodeExecutionEnv } = node;
const { FileError, getOrThrow } = envModule;
const { awaited } = effectSupport;
const { cleanUpEnvTests, createTempDir, tempDirs } = envNodeSupport;
const { joinPath, makeSymlink, pathExists, realPath } = platformSupport;

afterEach(() => Effect.runPromise(cleanUpEnvTests), 15_000);

const readsWritesLists = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  expect(getOrThrow(yield* awaited(env.absolutePath("nested/child", BACKGROUND_CONTEXT)))).toBe(
    joinPath(root, "nested/child"),
  );
  expect(
    getOrThrow(yield* awaited(env.joinPath([root, "nested", "child"], BACKGROUND_CONTEXT))),
  ).toBe(joinPath(root, "nested", "child"));
  getOrThrow(yield* awaited(env.createDir("nested/child", undefined, BACKGROUND_CONTEXT)));
  getOrThrow(yield* awaited(env.writeFile("nested/child/file.txt", "hel", BACKGROUND_CONTEXT)));
  getOrThrow(yield* awaited(env.appendFile("nested/child/file.txt", "lo", BACKGROUND_CONTEXT)));
  expect(
    getOrThrow(yield* awaited(env.readTextFile("nested/child/file.txt", BACKGROUND_CONTEXT))),
  ).toBe("hello");
  expect(
    getOrThrow(
      yield* awaited(
        env.readTextLines("nested/child/file.txt", { maxLines: 1 }, BACKGROUND_CONTEXT),
      ),
    ),
  ).toEqual(["hello"]);
  expect(
    Buffer.from(
      getOrThrow(yield* awaited(env.readBinaryFile("nested/child/file.txt", BACKGROUND_CONTEXT))),
    ).toString("utf8"),
  ).toBe("hello");

  const entries = getOrThrow(yield* awaited(env.listDir("nested/child", BACKGROUND_CONTEXT)));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    kind: "file",
    name: "file.txt",
    path: joinPath(root, "nested/child/file.txt"),
    size: 5,
  });
  expect(typeof entries[0]!.mtimeMs).toBe("number");

  expect(getOrThrow(yield* awaited(env.exists("nested/child/file.txt", BACKGROUND_CONTEXT)))).toBe(
    true,
  );
  getOrThrow(yield* awaited(env.remove("nested/child/file.txt", undefined, BACKGROUND_CONTEXT)));
  expect(getOrThrow(yield* awaited(env.exists("nested/child/file.txt", BACKGROUND_CONTEXT)))).toBe(
    false,
  );
});

describe("NodeExecutionEnv filesystem", () => {
  it("reads, writes, lists, and removes files and directories", () =>
    Effect.runPromise(readsWritesLists));
});

const expandsHomeRelative = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  expect(
    getOrThrow(yield* awaited(env.absolutePath("~/msa-node-env-test", BACKGROUND_CONTEXT))),
  ).toBe(joinPath(homedir(), "msa-node-env-test"));
  const filePath = joinPath(root, "file with spaces.txt");
  expect(
    getOrThrow(yield* awaited(env.absolutePath(pathToFileURL(filePath).href, BACKGROUND_CONTEXT))),
  ).toBe(filePath);
});

const returnsFileInfoFiles = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.createDir("dir", { recursive: true }, BACKGROUND_CONTEXT)));
  getOrThrow(yield* awaited(env.writeFile("dir/file.txt", "hello", BACKGROUND_CONTEXT)));
  yield* makeSymlink(joinPath(root, "dir/file.txt"), joinPath(root, "file-link"));
  yield* makeSymlink(joinPath(root, "dir"), joinPath(root, "dir-link"));

  expect(getOrThrow(yield* awaited(env.fileInfo("dir", BACKGROUND_CONTEXT)))).toMatchObject({
    kind: "directory",
    name: "dir",
    path: joinPath(root, "dir"),
  });
  expect(
    getOrThrow(yield* awaited(env.fileInfo("dir/file.txt", BACKGROUND_CONTEXT))),
  ).toMatchObject({
    kind: "file",
    name: "file.txt",
    path: joinPath(root, "dir/file.txt"),
    size: 5,
  });
  expect(getOrThrow(yield* awaited(env.fileInfo("file-link", BACKGROUND_CONTEXT)))).toMatchObject({
    kind: "symlink",
    name: "file-link",
    path: joinPath(root, "file-link"),
  });
  expect(getOrThrow(yield* awaited(env.fileInfo("dir-link", BACKGROUND_CONTEXT)))).toMatchObject({
    kind: "symlink",
    name: "dir-link",
    path: joinPath(root, "dir-link"),
  });
  expect(getOrThrow(yield* awaited(env.canonicalPath("file-link", BACKGROUND_CONTEXT)))).toBe(
    yield* realPath(joinPath(root, "dir/file.txt")),
  );
});

describe("NodeExecutionEnv filesystem", () => {
  it("expands home-relative paths and file URLs", () => Effect.runPromise(expandsHomeRelative));

  it("returns fileInfo for files, directories, and symlinks without following symlinks", () =>
    Effect.runPromise(returnsFileInfoFiles));
});

const listsSymlinksSymlinks = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile("target.txt", "hello", BACKGROUND_CONTEXT)));
  yield* makeSymlink(joinPath(root, "target.txt"), joinPath(root, "link.txt"));

  const entries = getOrThrow(yield* awaited(env.listDir(".", BACKGROUND_CONTEXT)));
  expect(
    entries
      .map((entry) => ({ kind: entry.kind, name: entry.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ).toEqual([
    { kind: "symlink", name: "link.txt" },
    { kind: "file", name: "target.txt" },
  ]);
});

const stopsReadingText = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile("file.txt", "one\ntwo\nthree", BACKGROUND_CONTEXT)));
  expect(
    getOrThrow(yield* awaited(env.readTextLines("file.txt", { maxLines: 1 }, BACKGROUND_CONTEXT))),
  ).toEqual(["one"]);
});

const returnsFileErrorMissing = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const info = yield* awaited(env.fileInfo("missing.txt", BACKGROUND_CONTEXT));
  expect(info.ok).toBe(false);
  if (!info.ok) {
    expect(info.error).toBeInstanceOf(FileError);
    expect(info.error).toMatchObject({
      code: "not_found",
      name: "FileError",
      path: joinPath(root, "missing.txt"),
    });
  }
  expect(getOrThrow(yield* awaited(env.exists("missing.txt", BACKGROUND_CONTEXT)))).toBe(false);
});

describe("NodeExecutionEnv filesystem", () => {
  it("lists symlinks as symlinks", () => Effect.runPromise(listsSymlinksSymlinks));

  it("stops reading text lines at the requested limit", () => Effect.runPromise(stopsReadingText));

  it("returns FileError for missing paths and keeps exists false for missing paths", () =>
    Effect.runPromise(returnsFileErrorMissing));
});

const returnsFileErrorListing = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile("file.txt", "hello", BACKGROUND_CONTEXT)));
  const result = yield* awaited(env.listDir("file.txt", BACKGROUND_CONTEXT));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBeInstanceOf(FileError);
    expect(result.error).toMatchObject({ code: "not_directory" });
  }
});

const appendsNewFiles = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.appendFile("new/nested/file.txt", "a", BACKGROUND_CONTEXT)));
  getOrThrow(yield* awaited(env.appendFile("new/nested/file.txt", "b", BACKGROUND_CONTEXT)));
  expect(
    getOrThrow(yield* awaited(env.readTextFile("new/nested/file.txt", BACKGROUND_CONTEXT))),
  ).toBe("ab");
});

const atomicallyRenamesFile = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile("source.txt", "new", BACKGROUND_CONTEXT)));
  getOrThrow(yield* awaited(env.writeFile("destination.txt", "old", BACKGROUND_CONTEXT)));

  getOrThrow(yield* awaited(env.renameFile("source.txt", "destination.txt", BACKGROUND_CONTEXT)));

  expect(getOrThrow(yield* awaited(env.exists("source.txt", BACKGROUND_CONTEXT)))).toBe(false);
  expect(getOrThrow(yield* awaited(env.readTextFile("destination.txt", BACKGROUND_CONTEXT)))).toBe(
    "new",
  );
});

describe("NodeExecutionEnv filesystem", () => {
  it("returns FileError for listing non-directories", () =>
    Effect.runPromise(returnsFileErrorListing));

  it("appends to new files and creates parent directories", () =>
    Effect.runPromise(appendsNewFiles));

  it("atomically renames a file and replaces the destination", () =>
    Effect.runPromise(atomicallyRenamesFile));
});

const reportsSourcePath = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile("destination.txt", "unchanged", BACKGROUND_CONTEXT)));

  const result = yield* awaited(
    env.renameFile("missing-source.txt", "destination.txt", BACKGROUND_CONTEXT),
  );

  expect(result).toMatchObject({
    error: {
      code: "not_found",
      path: joinPath(root, "missing-source.txt"),
    },
    ok: false,
  });
  expect(getOrThrow(yield* awaited(env.readTextFile("destination.txt", BACKGROUND_CONTEXT)))).toBe(
    "unchanged",
  );
});

const createsTemporaryDirectories = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const tempDir = getOrThrow(
    yield* awaited(env.createTempDir("node-env-test-", BACKGROUND_CONTEXT)),
  );
  tempDirs.push(tempDir);
  expect(yield* pathExists(tempDir)).toBe(true);
  const tempFile = getOrThrow(
    yield* awaited(env.createTempFile({ prefix: "prefix-", suffix: ".txt" }, BACKGROUND_CONTEXT)),
  );
  tempDirs.push(joinPath(tempFile, ".."));
  expect(yield* pathExists(tempFile)).toBe(true);
  expect(tempFile.endsWith(".txt")).toBe(true);
  expect(getOrThrow(yield* awaited(env.readTextFile(tempFile, BACKGROUND_CONTEXT)))).toBe("");
});

describe("NodeExecutionEnv filesystem", () => {
  it("reports the source path when rename fails because the source is missing", () =>
    Effect.runPromise(reportsSourcePath));

  it("creates temporary directories and files", () =>
    Effect.runPromise(createsTemporaryDirectories));
});

const honorsCreateDirRecursive = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const createResult = yield* awaited(
    env.createDir("missing/child", { recursive: false }, BACKGROUND_CONTEXT),
  );
  expect(createResult.ok).toBe(false);
  if (!createResult.ok) expect(createResult.error).toMatchObject({ code: "not_found" });

  getOrThrow(yield* awaited(env.writeFile("dir/child/file.txt", "hello", BACKGROUND_CONTEXT)));
  const removeDirectory = yield* awaited(
    env.remove("dir", { recursive: false }, BACKGROUND_CONTEXT),
  );
  expect(removeDirectory.ok).toBe(false);
  getOrThrow(yield* awaited(env.remove("dir", { recursive: true }, BACKGROUND_CONTEXT)));
  expect(getOrThrow(yield* awaited(env.exists("dir", BACKGROUND_CONTEXT)))).toBe(false);

  const removeMissing = yield* awaited(env.remove("missing", { force: false }, BACKGROUND_CONTEXT));
  expect(removeMissing.ok).toBe(false);
  getOrThrow(yield* awaited(env.remove("missing", { force: true }, BACKGROUND_CONTEXT)));
});

describe("NodeExecutionEnv filesystem", () => {
  it("honors createDir recursive false and remove recursive/force options", () =>
    Effect.runPromise(honorsCreateDirRecursive));
});
