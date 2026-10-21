import platform from "../../../src/core/platform/index.ts";

const GUEST_WORKSPACE = "/workspace";

function stripAtPrefix(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function toPosix(value: string): string {
  return value.split(platform.sep).join(platform.posix.sep);
}

function isInsideHostPath(root: string, value: string): boolean {
  const relativePath = platform.relative(root, value);
  return (
    relativePath === "" || (!relativePath.startsWith("..") && !platform.isAbsolute(relativePath))
  );
}

function hostPathToGuest(localCwd: string, hostPath: string): string {
  const relativePath = platform.relative(localCwd, hostPath);
  if (!isInsideHostPath(localCwd, hostPath)) return toPosix(hostPath);
  return relativePath === ""
    ? GUEST_WORKSPACE
    : platform.posix.join(GUEST_WORKSPACE, toPosix(relativePath));
}

function toGuestPath(localCwd: string, inputPath: string): string {
  const trimmed = stripAtPrefix(inputPath.trim());
  if (trimmed === "") return GUEST_WORKSPACE;
  if (platform.isAbsolute(trimmed)) {
    if (isInsideHostPath(localCwd, trimmed)) return hostPathToGuest(localCwd, trimmed);
    return platform.posix.resolve("/", toPosix(trimmed));
  }
  return platform.posix.resolve(GUEST_WORKSPACE, toPosix(trimmed));
}

function matchesToolGlob(relativePath: string, pattern: string): boolean {
  const normalizedPattern = toPosix(pattern);
  if (normalizedPattern.includes("/")) {
    return (
      platform.posix.matchesGlob(relativePath, normalizedPattern) ||
      platform.posix.matchesGlob(relativePath, `**/${normalizedPattern}`)
    );
  }
  return platform.posix.matchesGlob(platform.posix.basename(relativePath), normalizedPattern);
}

const signalOption = (signal: AbortSignal | undefined): { signal?: AbortSignal } =>
  signal === undefined ? {} : { signal };

const paths = {
  GUEST_WORKSPACE,
  matchesToolGlob,
  signalOption,
  toGuestPath,
};

export default paths;
