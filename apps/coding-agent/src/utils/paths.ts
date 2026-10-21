import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { dual } from "effect/Function";

import platformNode from "../core/platform-node.ts";
import nodeFs from "../core/platform/node/fs.ts";
import childProcess from "./child-process.ts";
import type pathsTypes from "./paths.types.ts";
import platformExtra from "./platform-extra.ts";

const { realpathSync, statSync } = nodeFs;

const { join, relative, resolve: nodeResolvePath, sep } = platformNode;
const { isAbsolute } = platformExtra;
const { spawnProcessSync } = childProcess;

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/gu;

function canonicalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function getFileRevision(path: string): string | undefined {
  try {
    const stats = statSync(path, { bigint: true });
    return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
  } catch {
    return undefined;
  }
}

function isLocalPath(value: string): boolean {
  const trimmed = value.trim();

  if (
    trimmed.startsWith("npm:") ||
    trimmed.startsWith("git:") ||
    trimmed.startsWith("github:") ||
    trimmed.startsWith("http:") ||
    trimmed.startsWith("https:") ||
    trimmed.startsWith("ssh:") ||
    trimmed.startsWith("builtin:")
  ) {
    return false;
  }
  return true;
}

function normalizeWindowsShellPath(filePath: string): string {
  if (!filePath.startsWith("/") || filePath.startsWith("//") || filePath.includes("\\"))
    return filePath;
  const match = filePath.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/iu);
  const [, drive, rest] = match ?? [];
  if (drive === undefined) return filePath;
  const suffix = rest?.replaceAll("/", "\\");
  return `${drive.toUpperCase()}:\\${suffix ?? ""}`;
}

function normalizePathImpl(input: string, options: pathsTypes.PathInputOptions = {}): string {
  let normalized = options.trim === true ? input.trim() : input;
  if (options.normalizeUnicodeSpaces === true) {
    normalized = normalized.replace(UNICODE_SPACES, " ");
  }
  if (options.stripAtPrefix === true && normalized.startsWith("@")) {
    normalized = normalized.slice(1);
  }
  if (process.platform === "win32") {
    normalized = normalizeWindowsShellPath(normalized);
  }

  if (options.expandTilde ?? true) {
    const home = options.homeDir ?? homedir();
    if (normalized === "~") return home;
    if (
      normalized.startsWith("~/") ||
      (process.platform === "win32" && normalized.startsWith("~\\"))
    ) {
      return join(home, normalized.slice(2));
    }
  }

  if (/^file:\/\//u.test(normalized)) {
    return fileURLToPath(normalized);
  }

  return normalized;
}

const normalizePath: {
  (input: string, options?: pathsTypes.PathInputOptions): string;
  (options?: pathsTypes.PathInputOptions): (input: string) => string;
} = dual((args: IArguments) => args.length >= 1, normalizePathImpl);

function resolvePathImpl(
  input: string,
  baseDir: string = process.cwd(),
  options: pathsTypes.PathInputOptions = {},
): string {
  const normalized = normalizePath(input, options);
  const normalizedBaseDir = normalizePath(baseDir);
  return isAbsolute(normalized)
    ? nodeResolvePath(normalized)
    : nodeResolvePath(normalizedBaseDir, normalized);
}

const resolvePath: {
  (input: string, baseDir?: string, options?: pathsTypes.PathInputOptions): string;
  (baseDir?: string, options?: pathsTypes.PathInputOptions): (input: string) => string;
} = dual((args: IArguments) => args.length >= 1, resolvePathImpl);

function getCwdRelativePathImpl(filePath: string, cwd: string): string | undefined {
  const resolvedCwd = resolvePath(cwd);
  const resolvedPath = resolvePath(filePath, resolvedCwd);
  const relativePath = relative(resolvedCwd, resolvedPath);
  const isInsideCwd =
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));

  return isInsideCwd ? (relativePath === "" ? "." : relativePath) : undefined;
}

const getCwdRelativePath: {
  (filePath: string, cwd: string): string | undefined;
  (cwd: string): (filePath: string) => string | undefined;
} = dual((args: IArguments) => args.length >= 2, getCwdRelativePathImpl);

function abbreviateHomePathImpl(filePath: string, home: string = homedir()): string {
  if (home === "" || !filePath.startsWith(home)) return filePath;
  const rest = filePath.slice(home.length);
  if (rest !== "" && !rest.startsWith("/") && !rest.startsWith("\\")) return filePath;
  return `~${rest}`;
}

const abbreviateHomePath: {
  (filePath: string, home?: string): string;
  (home?: string): (filePath: string) => string;
} = dual((args: IArguments) => args.length >= 1, abbreviateHomePathImpl);

function formatPathRelativeToCwdOrAbsoluteImpl(filePath: string, cwd: string): string {
  const absolutePath = resolvePath(filePath, cwd);
  return (getCwdRelativePath(absolutePath, cwd) ?? absolutePath).split(sep).join("/");
}

const formatPathRelativeToCwdOrAbsolute: {
  (filePath: string, cwd: string): string;
  (cwd: string): (filePath: string) => string;
} = dual((args: IArguments) => args.length >= 2, formatPathRelativeToCwdOrAbsoluteImpl);

function markPathIgnoredByCloudSync(path: string): void {
  const attrs =
    process.platform === "darwin"
      ? ["com.dropbox.ignored", "com.apple.fileprovider.ignore#P"]
      : process.platform === "linux"
        ? ["user.com.dropbox.ignored"]
        : [];

  for (const attr of attrs) {
    if (process.platform === "darwin") {
      spawnProcessSync("xattr", ["-w", attr, "1", path], { encoding: "utf-8", stdio: "ignore" });
    } else {
      spawnProcessSync("setfattr", ["-n", attr, "-v", "1", path], {
        encoding: "utf-8",
        stdio: "ignore",
      });
    }
  }
}

function isPathWithin(target: string, root: string): boolean {
  const normalizedRoot = nodeResolvePath(root);
  if (target === normalizedRoot) return true;
  const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return target.startsWith(prefix);
}

const paths = {
  abbreviateHomePath,
  canonicalizePath,
  formatPathRelativeToCwdOrAbsolute,
  getCwdRelativePath,
  getFileRevision,
  isLocalPath,
  isPathWithin,
  markPathIgnoredByCloudSync,
  normalizePath,
  normalizeWindowsShellPath,
  resolvePath,
};

export default paths;
