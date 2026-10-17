import { access, chmod, realpath, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { FileError, getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { removeTempDir, chmodRestorePaths, tempDirs, createTempDir } from "./env-node-support.ts";

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
  it("reads, writes, lists, and removes files and directories", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    expect(getOrThrow(await env.absolutePath("nested/child", BACKGROUND_CONTEXT))).toBe(
      join(root, "nested/child"),
    );
    expect(getOrThrow(await env.joinPath([root, "nested", "child"], BACKGROUND_CONTEXT))).toBe(
      join(root, "nested", "child"),
    );
    getOrThrow(await env.createDir("nested/child", undefined, BACKGROUND_CONTEXT));
    getOrThrow(await env.writeFile("nested/child/file.txt", "hel", BACKGROUND_CONTEXT));
    getOrThrow(await env.appendFile("nested/child/file.txt", "lo", BACKGROUND_CONTEXT));
    expect(getOrThrow(await env.readTextFile("nested/child/file.txt", BACKGROUND_CONTEXT))).toBe(
      "hello",
    );
    expect(
      getOrThrow(
        await env.readTextLines("nested/child/file.txt", { maxLines: 1 }, BACKGROUND_CONTEXT),
      ),
    ).toEqual(["hello"]);
    expect(
      Buffer.from(
        getOrThrow(await env.readBinaryFile("nested/child/file.txt", BACKGROUND_CONTEXT)),
      ).toString("utf8"),
    ).toBe("hello");

    const entries = getOrThrow(await env.listDir("nested/child", BACKGROUND_CONTEXT));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "file.txt",
      path: join(root, "nested/child/file.txt"),
      kind: "file",
      size: 5,
    });
    expect(typeof entries[0]!.mtimeMs).toBe("number");

    expect(getOrThrow(await env.exists("nested/child/file.txt", BACKGROUND_CONTEXT))).toBe(true);
    getOrThrow(await env.remove("nested/child/file.txt", undefined, BACKGROUND_CONTEXT));
    expect(getOrThrow(await env.exists("nested/child/file.txt", BACKGROUND_CONTEXT))).toBe(false);
  });
});

describe("NodeExecutionEnv filesystem", () => {
  it("expands home-relative paths and file URLs", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    expect(getOrThrow(await env.absolutePath("~/msa-node-env-test", BACKGROUND_CONTEXT))).toBe(
      join(homedir(), "msa-node-env-test"),
    );
    const filePath = join(root, "file with spaces.txt");
    expect(
      getOrThrow(await env.absolutePath(pathToFileURL(filePath).href, BACKGROUND_CONTEXT)),
    ).toBe(filePath);
  });

  it("returns fileInfo for files, directories, and symlinks without following symlinks", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.createDir("dir", { recursive: true }, BACKGROUND_CONTEXT));
    getOrThrow(await env.writeFile("dir/file.txt", "hello", BACKGROUND_CONTEXT));
    await symlink(join(root, "dir/file.txt"), join(root, "file-link"));
    await symlink(join(root, "dir"), join(root, "dir-link"));

    expect(getOrThrow(await env.fileInfo("dir", BACKGROUND_CONTEXT))).toMatchObject({
      name: "dir",
      path: join(root, "dir"),
      kind: "directory",
    });
    expect(getOrThrow(await env.fileInfo("dir/file.txt", BACKGROUND_CONTEXT))).toMatchObject({
      name: "file.txt",
      path: join(root, "dir/file.txt"),
      kind: "file",
      size: 5,
    });
    expect(getOrThrow(await env.fileInfo("file-link", BACKGROUND_CONTEXT))).toMatchObject({
      name: "file-link",
      path: join(root, "file-link"),
      kind: "symlink",
    });
    expect(getOrThrow(await env.fileInfo("dir-link", BACKGROUND_CONTEXT))).toMatchObject({
      name: "dir-link",
      path: join(root, "dir-link"),
      kind: "symlink",
    });
    expect(getOrThrow(await env.canonicalPath("file-link", BACKGROUND_CONTEXT))).toBe(
      await realpath(join(root, "dir/file.txt")),
    );
  });
});

describe("NodeExecutionEnv filesystem", () => {
  it("lists symlinks as symlinks", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("target.txt", "hello", BACKGROUND_CONTEXT));
    await symlink(join(root, "target.txt"), join(root, "link.txt"));

    const entries = getOrThrow(await env.listDir(".", BACKGROUND_CONTEXT));
    expect(
      entries
        .map((entry) => ({ name: entry.name, kind: entry.kind }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { name: "link.txt", kind: "symlink" },
      { name: "target.txt", kind: "file" },
    ]);
  });

  it("stops reading text lines at the requested limit", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("file.txt", "one\ntwo\nthree", BACKGROUND_CONTEXT));
    expect(
      getOrThrow(await env.readTextLines("file.txt", { maxLines: 1 }, BACKGROUND_CONTEXT)),
    ).toEqual(["one"]);
  });

  it("returns FileError for missing paths and keeps exists false for missing paths", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const info = await env.fileInfo("missing.txt", BACKGROUND_CONTEXT);
    expect(info.ok).toBe(false);
    if (!info.ok) {
      expect(info.error).toBeInstanceOf(FileError);
      expect(info.error).toMatchObject({
        name: "FileError",
        code: "not_found",
        path: join(root, "missing.txt"),
      });
    }
    expect(getOrThrow(await env.exists("missing.txt", BACKGROUND_CONTEXT))).toBe(false);
  });
});

describe("NodeExecutionEnv filesystem", () => {
  it("returns FileError for listing non-directories", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("file.txt", "hello", BACKGROUND_CONTEXT));
    const result = await env.listDir("file.txt", BACKGROUND_CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(FileError);
      expect(result.error).toMatchObject({ code: "not_directory" });
    }
  });

  it("appends to new files and creates parent directories", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.appendFile("new/nested/file.txt", "a", BACKGROUND_CONTEXT));
    getOrThrow(await env.appendFile("new/nested/file.txt", "b", BACKGROUND_CONTEXT));
    expect(getOrThrow(await env.readTextFile("new/nested/file.txt", BACKGROUND_CONTEXT))).toBe(
      "ab",
    );
  });

  it("atomically renames a file and replaces the destination", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("source.txt", "new", BACKGROUND_CONTEXT));
    getOrThrow(await env.writeFile("destination.txt", "old", BACKGROUND_CONTEXT));

    getOrThrow(await env.renameFile("source.txt", "destination.txt", BACKGROUND_CONTEXT));

    expect(getOrThrow(await env.exists("source.txt", BACKGROUND_CONTEXT))).toBe(false);
    expect(getOrThrow(await env.readTextFile("destination.txt", BACKGROUND_CONTEXT))).toBe("new");
  });
});

describe("NodeExecutionEnv filesystem", () => {
  it("reports the source path when rename fails because the source is missing", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("destination.txt", "unchanged", BACKGROUND_CONTEXT));

    const result = await env.renameFile(
      "missing-source.txt",
      "destination.txt",
      BACKGROUND_CONTEXT,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "not_found",
        path: join(root, "missing-source.txt"),
      },
    });
    expect(getOrThrow(await env.readTextFile("destination.txt", BACKGROUND_CONTEXT))).toBe(
      "unchanged",
    );
  });

  it("creates temporary directories and files", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const tempDir = getOrThrow(await env.createTempDir("node-env-test-", BACKGROUND_CONTEXT));
    tempDirs.push(tempDir);
    await expect(access(tempDir)).resolves.toBeUndefined();
    const tempFile = getOrThrow(
      await env.createTempFile({ prefix: "prefix-", suffix: ".txt" }, BACKGROUND_CONTEXT),
    );
    tempDirs.push(join(tempFile, ".."));
    await expect(access(tempFile)).resolves.toBeUndefined();
    expect(tempFile.endsWith(".txt")).toBe(true);
    expect(getOrThrow(await env.readTextFile(tempFile, BACKGROUND_CONTEXT))).toBe("");
  });
});

describe("NodeExecutionEnv filesystem", () => {
  it("honors createDir recursive false and remove recursive/force options", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const createResult = await env.createDir(
      "missing/child",
      { recursive: false },
      BACKGROUND_CONTEXT,
    );
    expect(createResult.ok).toBe(false);
    if (!createResult.ok) expect(createResult.error).toMatchObject({ code: "not_found" });

    getOrThrow(await env.writeFile("dir/child/file.txt", "hello", BACKGROUND_CONTEXT));
    const removeDirectory = await env.remove("dir", { recursive: false }, BACKGROUND_CONTEXT);
    expect(removeDirectory.ok).toBe(false);
    getOrThrow(await env.remove("dir", { recursive: true }, BACKGROUND_CONTEXT));
    expect(getOrThrow(await env.exists("dir", BACKGROUND_CONTEXT))).toBe(false);

    const removeMissing = await env.remove("missing", { force: false }, BACKGROUND_CONTEXT);
    expect(removeMissing.ok).toBe(false);
    getOrThrow(await env.remove("missing", { force: true }, BACKGROUND_CONTEXT));
  });
});
