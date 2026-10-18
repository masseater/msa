import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { joinPath, resolvePath } from "@msa/testing";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  canonicalizePath,
  getCwdRelativePath,
  isLocalPath,
  normalizePath,
  normalizeWindowsShellPath,
  resolvePath as resolvePathTo,
} from "../src/utils/paths.ts";

let tempDir: string;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

function createTempDir(): string {
  tempDir = mkdtempSync(joinPath(tmpdir(), "msa-paths-"));
  return tempDir;
}

describe("canonicalizePath", () => {
  it("returns the real path for a regular file", () => {
    const dir = createTempDir();
    const file = joinPath(dir, "file.txt");
    writeFileSync(file, "hello");
    expect(canonicalizePath(file)).toBe(realpathSync(file));
  });

  it("resolves symlinks to their targets", () => {
    const dir = createTempDir();
    const target = joinPath(dir, "target.txt");
    const link = joinPath(dir, "link.txt");
    writeFileSync(target, "hello");
    symlinkSync(target, link);
    expect(canonicalizePath(link)).toBe(realpathSync(target));
  });

  it("resolves directory symlinks", () => {
    const dir = createTempDir();
    const targetDir = joinPath(dir, "target-dir");
    const linkDir = joinPath(dir, "link-dir");
    mkdirSync(targetDir);
    symlinkSync(targetDir, linkDir, "dir");
    expect(canonicalizePath(linkDir)).toBe(realpathSync(targetDir));
  });

  it("falls back to the raw path when the target does not exist", () => {
    const dir = createTempDir();
    const nonexistent = joinPath(dir, "no-such-file");
    expect(canonicalizePath(nonexistent)).toBe(nonexistent);
  });

  it("falls back to the raw path for a dangling symlink", () => {
    const dir = createTempDir();
    const target = joinPath(dir, "target.txt");
    const link = joinPath(dir, "link.txt");

    symlinkSync(target, link);

    expect(canonicalizePath(link)).toBe(link);
  });
});

describe("getCwdRelativePath", () => {
  it("keeps cwd-relative names that start with dots", () => {
    const cwd = joinPath(tmpdir(), "msa-paths-cwd");
    expect(getCwdRelativePath(joinPath(cwd, "..config", "AGENTS.md"), cwd)).toBe(
      joinPath("..config", "AGENTS.md"),
    );
  });

  it("rejects parent-directory traversals", () => {
    const cwd = joinPath(tmpdir(), "msa-paths-cwd");
    expect(getCwdRelativePath(joinPath(cwd, "..", "AGENTS.md"), cwd)).toBeUndefined();
  });
});

describe("resolvePath", () => {
  it("expands only home tilde shortcuts", () => {
    const cwd = joinPath(tmpdir(), "msa-paths-cwd");
    expect(normalizePath("~")).toBe(homedir());
    expect(normalizePath("~/file.txt")).toBe(joinPath(homedir(), "file.txt"));
    expect(resolvePathTo("~draft.md", cwd)).toBe(resolvePath(cwd, "~draft.md"));
    expect(normalizePath("~draft.md")).toBe("~draft.md");
  });

  it("resolves relative paths against the base directory", () => {
    const cwd = joinPath(tmpdir(), "msa-paths-cwd");
    expect(resolvePathTo("subdir/file.txt", cwd)).toBe(resolvePath(cwd, "subdir/file.txt"));
    expect(resolvePathTo("subdir/file.txt", pathToFileURL(cwd).href)).toBe(
      resolvePath(cwd, "subdir/file.txt"),
    );
  });

  it("accepts file URLs", () => {
    const dir = createTempDir();
    const filePath = joinPath(dir, "file with spaces.txt");
    expect(resolvePathTo(pathToFileURL(filePath).href, joinPath(dir, "base"))).toBe(
      resolvePath(filePath),
    );
  });

  it("throws for invalid file URLs", () => {
    expect(() => resolvePathTo("file:///%E0%A4%A")).toThrow();
  });

  it("preserves POSIX absolute paths with literal percent sequences", () => {
    if (process.platform === "win32") {
      return;
    }

    const dir = createTempDir();
    for (const filePath of [
      joinPath(dir, "report%2026.md"),
      joinPath(dir, "foo%2Fbar"),
      joinPath(dir, "malformed%A.md"),
    ]) {
      expect(resolvePathTo(filePath, joinPath(dir, "base"))).toBe(resolvePath(filePath));
    }
  });

  it("does not treat Windows file URL pathname strings as native paths", () => {
    if (process.platform !== "win32") {
      return;
    }

    const dir = createTempDir();
    const filePath = joinPath(dir, "dir", "SKILL.md");
    const pathname = pathToFileURL(filePath).pathname;
    expect(pathname).toMatch(/^\/[A-Za-z]:/u);
    expect(resolvePathTo(pathname, "E:\\project")).toBe(resolvePath(pathname));
  });
});

describe("normalizeWindowsShellPath", () => {
  it("converts Git Bash, MSYS, Cygwin, and WSL drive paths", () => {
    expect(normalizeWindowsShellPath("/c/Users/example/project")).toBe(
      "C:\\Users\\example\\project",
    );
    expect(normalizeWindowsShellPath("/cygdrive/d/work")).toBe("D:\\work");
    expect(normalizeWindowsShellPath("/mnt/e/source")).toBe("E:\\source");
    expect(normalizeWindowsShellPath("/c")).toBe("C:\\");
  });

  it("leaves other path forms unchanged", () => {
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
  });

  it.runIf(process.platform === "win32")("is applied by normal path handling on Windows", () => {
    expect(normalizePath("/c/Users/example")).toBe("C:\\Users\\example");
    expect(resolvePathTo("/mnt/c/Users/example", "D:\\work")).toBe(resolvePath("C:/Users/example"));
  });
});

describe("isLocalPath", () => {
  it("returns true for bare names", () => {
    expect(isLocalPath("my-package")).toBe(true);
  });

  it("returns true for relative paths", () => {
    expect(isLocalPath("./foo")).toBe(true);
  });

  it("returns true for file URLs", () => {
    expect(isLocalPath("file:///tmp/foo")).toBe(true);
  });

  it("returns false for npm: protocol", () => {
    expect(isLocalPath("npm:package")).toBe(false);
  });

  it("returns false for git: protocol", () => {
    expect(isLocalPath("git://repo")).toBe(false);
  });

  it("returns false for https: protocol", () => {
    expect(isLocalPath("https://example.com")).toBe(false);
  });
});
