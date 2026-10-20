import nodePath from "../../../src/core/platform/node/path.ts";

const GUEST_WORKSPACE = "/workspace";

function stripAtPrefix(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function toPosix(value: string): string {
  return value.split(nodePath.sep).join(nodePath.posix.sep);
}

function isInsideHostPath(root: string, value: string): boolean {
  const relativePath = nodePath.relative(root, value);
  return (
    relativePath === "" || (!relativePath.startsWith("..") && !nodePath.isAbsolute(relativePath))
  );
}

function hostPathToGuest(localCwd: string, hostPath: string): string {
  const relativePath = nodePath.relative(localCwd, hostPath);
  if (!isInsideHostPath(localCwd, hostPath)) return toPosix(hostPath);
  return relativePath === ""
    ? GUEST_WORKSPACE
    : nodePath.posix.join(GUEST_WORKSPACE, toPosix(relativePath));
}

function toGuestPath(localCwd: string, inputPath: string): string {
  const trimmed = stripAtPrefix(inputPath.trim());
  if (trimmed === "") return GUEST_WORKSPACE;
  if (nodePath.isAbsolute(trimmed)) {
    if (isInsideHostPath(localCwd, trimmed)) return hostPathToGuest(localCwd, trimmed);
    return nodePath.posix.resolve("/", toPosix(trimmed));
  }
  return nodePath.posix.resolve(GUEST_WORKSPACE, toPosix(trimmed));
}

function matchesToolGlob(relativePath: string, pattern: string): boolean {
  const normalizedPattern = toPosix(pattern);
  if (normalizedPattern.includes("/")) {
    return (
      nodePath.posix.matchesGlob(relativePath, normalizedPattern) ||
      nodePath.posix.matchesGlob(relativePath, `**/${normalizedPattern}`)
    );
  }
  return nodePath.posix.matchesGlob(nodePath.posix.basename(relativePath), normalizedPattern);
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
