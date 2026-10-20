import { Effect } from "effect";

import type autocompleteFdTypes from "./autocomplete-fd.types.ts";
import autocompletePrefix from "./autocomplete-prefix.ts";
import platformModule from "./platform.ts";
import type platformTypes from "./platform.types.ts";

const { toDisplayPath } = autocompletePrefix;
const { Platform } = platformModule;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function buildFdPathQuery(query: string): string {
  const normalized = toDisplayPath(query);
  if (!normalized.includes("/")) {
    return normalized;
  }

  const hasTrailingSeparator = normalized.endsWith("/");
  const trimmed = normalized.replace(/^\/+|\/+$/gu, "");
  if (trimmed === "") {
    return normalized;
  }

  const separatorPattern = "[\\\\/]";
  const segments = trimmed
    .split("/")
    .filter(Boolean)
    .map((segment) => escapeRegex(segment));
  if (segments.length === 0) {
    return normalized;
  }

  let pattern = segments.join(separatorPattern);
  if (hasTrailingSeparator) {
    pattern += separatorPattern;
  }
  return pattern;
}

function buildFdArgs(options: autocompleteFdTypes.FdWalkOptions): string[] {
  const args = [
    "--base-directory",
    options.baseDir,
    "--max-results",
    String(options.maxResults),
    "--type",
    "f",
    "--type",
    "d",
    "--follow",
    "--hidden",
    "--exclude",
    ".git",
    "--exclude",
    ".git/*",
    "--exclude",
    ".git/**",
  ];

  if (options.maxDepth !== undefined) {
    args.push("--max-depth", String(options.maxDepth));
  }

  if (toDisplayPath(options.query).includes("/")) {
    args.push("--full-path");
  }

  if (options.query !== "") {
    args.push(buildFdPathQuery(options.query));
  }
  return args;
}

function parseFdOutput(stdout: string): autocompleteFdTypes.FdEntry[] {
  const lines = stdout.trim().split("\n").filter(Boolean);
  const results: autocompleteFdTypes.FdEntry[] = [];

  for (const line of lines) {
    const displayLine = toDisplayPath(line);
    const hasTrailingSeparator = displayLine.endsWith("/");
    const normalizedPath = hasTrailingSeparator ? displayLine.slice(0, -1) : displayLine;
    if (
      normalizedPath === ".git" ||
      normalizedPath.startsWith(".git/") ||
      normalizedPath.includes("/.git/")
    ) {
      continue;
    }

    results.push({
      isDirectory: hasTrailingSeparator,
      path: displayLine,
    });
  }
  return results;
}

const waitForAbort = (signal: AbortSignal): Effect.Effect<autocompleteFdTypes.FdEntry[]> =>
  Effect.callback<autocompleteFdTypes.FdEntry[]>((resume) => {
    const onAbort = (): void => {
      resume(Effect.succeed([]));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });

function walkDirectoryWithFd(
  options: autocompleteFdTypes.FdWalkOptions,
): Effect.Effect<autocompleteFdTypes.FdEntry[], never, platformTypes.Platform> {
  const args = buildFdArgs(options);
  const { signal } = options;
  return Effect.suspend(() => {
    if (signal.aborted) return Effect.succeed([]);
    return Platform.use((platform) => platform.runCommand({ args, file: options.fdPath })).pipe(
      Effect.map(({ exitCode, stdout }) =>
        signal.aborted || exitCode !== 0 || stdout === "" ? [] : parseFdOutput(stdout),
      ),
      Effect.orElseSucceed((): autocompleteFdTypes.FdEntry[] => []),
      Effect.raceFirst(waitForAbort(signal)),
    );
  });
}

const autocompleteFd = {
  walkDirectoryWithFd,
};

export default autocompleteFd;
