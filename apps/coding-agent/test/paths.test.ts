import { homedir, tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import testing from "@msa/testing";
import { Effect, FileSystem } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import paths from "../src/utils/paths.ts";

const {
  canonicalizePath,
  getCwdRelativePath,
  isLocalPath,
  normalizePath,
  normalizeWindowsShellPath,
  resolvePath: resolvePathTo,
} = paths;

const {
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  resolvePath,
  runTest,
  provideNode,
  runTestSync,
  writeTextFile,
} = testing;

const fileSystem = runTestSync(provideNode(FileSystem.FileSystem.useSync((service) => service)));

const realPath = (file: string): Effect.Effect<string> => Effect.orDie(fileSystem.realPath(file));

const symlink = (from: string, to: string): Effect.Effect<void> =>
  Effect.orDie(fileSystem.symlink(from, to));

let tempDir = "";

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      if (tempDir.length > 0) {
        yield* removePath(tempDir);
        tempDir = "";
      }
    }),
  ),
);

const createTempDir: Effect.Effect<string> = Effect.gen(function* () {
  tempDir = yield* makeTempDir("msa-paths-");
  return tempDir;
});

const returnsTheRealPathForARegular = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir;
      const file = joinPath(dir, "file.txt");
      yield* writeTextFile(file, "hello");
      expect(canonicalizePath(file)).toBe(yield* realPath(file));
    }),
  );

const resolvesSymlinksToTheirTargets = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir;
      const target = joinPath(dir, "target.txt");
      const link = joinPath(dir, "link.txt");
      yield* writeTextFile(target, "hello");
      yield* symlink(target, link);
      expect(canonicalizePath(link)).toBe(yield* realPath(target));
    }),
  );

const resolvesDirectorySymlinks = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir;
      const targetDir = joinPath(dir, "target-dir");
      const linkDir = joinPath(dir, "link-dir");
      yield* makeDirectory(targetDir);
      yield* symlink(targetDir, linkDir);
      expect(canonicalizePath(linkDir)).toBe(yield* realPath(targetDir));
    }),
  );

const fallsBackToTheRawPathWhen = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir;
      const nonexistent = joinPath(dir, "no-such-file");
      expect(canonicalizePath(nonexistent)).toBe(nonexistent);
    }),
  );

const fallsBackToTheRawPathFor = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir;
      const target = joinPath(dir, "target.txt");
      const link = joinPath(dir, "link.txt");

      yield* symlink(target, link);

      expect(canonicalizePath(link)).toBe(link);
    }),
  );

describe("canonicalizePath", () => {
  it("returns the real path for a regular file", returnsTheRealPathForARegular);

  it("resolves symlinks to their targets", resolvesSymlinksToTheirTargets);

  it("resolves directory symlinks", resolvesDirectorySymlinks);

  it("falls back to the raw path when the target does not exist", fallsBackToTheRawPathWhen);

  it("falls back to the raw path for a dangling symlink", fallsBackToTheRawPathFor);
});

const keepsCwdRelativeNamesThatStartWith = () => {
  const cwd = joinPath(tmpdir(), "msa-paths-cwd");
  expect(getCwdRelativePath(joinPath(cwd, "..config", "AGENTS.md"), cwd)).toBe(
    joinPath("..config", "AGENTS.md"),
  );
};

const rejectsParentDirectoryTraversals = () => {
  const cwd = joinPath(tmpdir(), "msa-paths-cwd");
  expect(getCwdRelativePath(joinPath(cwd, "..", "AGENTS.md"), cwd)).toBeUndefined();
};

describe("getCwdRelativePath", () => {
  it("keeps cwd-relative names that start with dots", keepsCwdRelativeNamesThatStartWith);

  it("rejects parent-directory traversals", rejectsParentDirectoryTraversals);
});

const expandsOnlyHomeTildeShortcuts = () => {
  const cwd = joinPath(tmpdir(), "msa-paths-cwd");
  expect(normalizePath("~")).toBe(homedir());
  expect(normalizePath("~/file.txt")).toBe(joinPath(homedir(), "file.txt"));
  expect(resolvePathTo("~draft.md", cwd)).toBe(resolvePath(cwd, "~draft.md"));
  expect(normalizePath("~draft.md")).toBe("~draft.md");
};

const resolvesRelativePathsAgainstTheBaseDirectory = () => {
  const cwd = joinPath(tmpdir(), "msa-paths-cwd");
  expect(resolvePathTo("subdir/file.txt", cwd)).toBe(resolvePath(cwd, "subdir/file.txt"));
  expect(resolvePathTo("subdir/file.txt", pathToFileURL(cwd).href)).toBe(
    resolvePath(cwd, "subdir/file.txt"),
  );
};

const acceptsFileUrls = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir;
      const filePath = joinPath(dir, "file with spaces.txt");
      expect(resolvePathTo(pathToFileURL(filePath).href, joinPath(dir, "base"))).toBe(
        resolvePath(filePath),
      );
    }),
  );

const throwsForInvalidFileUrls = () => {
  expect(() => resolvePathTo("file:///%E0%A4%A")).toThrow();
};

const preservesPosixAbsolutePathsWithLiteralPercent = () =>
  runTest(
    Effect.gen(function* () {
      if (process.platform === "win32") {
        return;
      }

      const dir = yield* createTempDir;
      for (const filePath of [
        joinPath(dir, "report%2026.md"),
        joinPath(dir, "foo%2Fbar"),
        joinPath(dir, "malformed%A.md"),
      ]) {
        expect(resolvePathTo(filePath, joinPath(dir, "base"))).toBe(resolvePath(filePath));
      }
    }),
  );

const doesNotTreatWindowsFileUrlPathname = () =>
  runTest(
    Effect.gen(function* () {
      if (process.platform !== "win32") {
        return;
      }

      const dir = yield* createTempDir;
      const filePath = joinPath(dir, "dir", "SKILL.md");
      const pathname = pathToFileURL(filePath).pathname;
      expect(pathname).toMatch(/^\/[A-Za-z]:/u);
      expect(resolvePathTo(pathname, "E:\\project")).toBe(resolvePath(pathname));
    }),
  );

describe("resolvePath", () => {
  it("expands only home tilde shortcuts", expandsOnlyHomeTildeShortcuts);

  it(
    "resolves relative paths against the base directory",
    resolvesRelativePathsAgainstTheBaseDirectory,
  );

  it("accepts file URLs", acceptsFileUrls);

  it("throws for invalid file URLs", throwsForInvalidFileUrls);

  it(
    "preserves POSIX absolute paths with literal percent sequences",
    preservesPosixAbsolutePathsWithLiteralPercent,
  );

  it(
    "does not treat Windows file URL pathname strings as native paths",
    doesNotTreatWindowsFileUrlPathname,
  );
});

const convertsGitBashMsysCygwinAndWsl = () => {
  expect(normalizeWindowsShellPath("/c/Users/example/project")).toBe("C:\\Users\\example\\project");
  expect(normalizeWindowsShellPath("/cygdrive/d/work")).toBe("D:\\work");
  expect(normalizeWindowsShellPath("/mnt/e/source")).toBe("E:\\source");
  expect(normalizeWindowsShellPath("/c")).toBe("C:\\");
};

const leavesOtherPathFormsUnchanged = () => {
  for (const path of [
    "C:/Users/example",
    "C:\\Users\\example",
    "//server/share/file",
    "/c/Users\\example",
    "relative/file",
    "/tmp/file",
  ]) {
    expect(normalizeWindowsShellPath(path)).toBe(path);
  }
};

const isAppliedByNormalPathHandlingOn = () => {
  expect(normalizePath("/c/Users/example")).toBe("C:\\Users\\example");
  expect(resolvePathTo("/mnt/c/Users/example", "D:\\work")).toBe(resolvePath("C:/Users/example"));
};

describe("normalizeWindowsShellPath", () => {
  it("converts Git Bash, MSYS, Cygwin, and WSL drive paths", convertsGitBashMsysCygwinAndWsl);

  it("leaves other path forms unchanged", leavesOtherPathFormsUnchanged);

  it.runIf(process.platform === "win32")(
    "is applied by normal path handling on Windows",
    isAppliedByNormalPathHandlingOn,
  );
});

const returnsTrueForBareNames = () => {
  expect(isLocalPath("my-package")).toBe(true);
};

const returnsTrueForRelativePaths = () => {
  expect(isLocalPath("./foo")).toBe(true);
};

const returnsTrueForFileUrls = () => {
  expect(isLocalPath("file:///tmp/foo")).toBe(true);
};

const returnsFalseForNpmProtocol = () => {
  expect(isLocalPath("npm:package")).toBe(false);
};

const returnsFalseForGitProtocol = () => {
  expect(isLocalPath("git://repo")).toBe(false);
};

const returnsFalseForHttpsProtocol = () => {
  expect(isLocalPath("https://example.com")).toBe(false);
};

describe("isLocalPath", () => {
  it("returns true for bare names", returnsTrueForBareNames);

  it("returns true for relative paths", returnsTrueForRelativePaths);

  it("returns true for file URLs", returnsTrueForFileUrls);

  it("returns false for npm: protocol", returnsFalseForNpmProtocol);

  it("returns false for git: protocol", returnsFalseForGitProtocol);

  it("returns false for https: protocol", returnsFalseForHttpsProtocol);
});
