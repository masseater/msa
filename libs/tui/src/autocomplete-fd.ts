import { Effect } from "effect";

import { toDisplayPath } from "./autocomplete-prefix.ts";
import { Platform } from "./platform.ts";

export interface FdEntry {
  path: string;
  isDirectory: boolean;
}

export interface FdWalkOptions {
  baseDir: string;
  fdPath: string;
  query: string;
  maxResults: number;
  signal: AbortSignal;
  maxDepth?: number;
}

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

function buildFdArgs(options: FdWalkOptions): string[] {
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

function parseFdOutput(stdout: string): FdEntry[] {
  const lines = stdout.trim().split("\n").filter(Boolean);
  const results: FdEntry[] = [];

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
      path: displayLine,
      isDirectory: hasTrailingSeparator,
    });
  }
  return results;
}

const waitForAbort = (signal: AbortSignal): Effect.Effect<FdEntry[]> =>
  Effect.callback<FdEntry[]>((resume) => {
    const onAbort = (): void => {
      resume(Effect.succeed([]));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });

export function walkDirectoryWithFd(
  options: FdWalkOptions,
): Effect.Effect<FdEntry[], never, Platform> {
  const args = buildFdArgs(options);
  const { signal } = options;
  return Effect.suspend(() => {
    if (signal.aborted) return Effect.succeed([]);
    return Platform.use((platform) => platform.runCommand({ file: options.fdPath, args })).pipe(
      Effect.map(({ exitCode, stdout }) =>
        signal.aborted || exitCode !== 0 || stdout === "" ? [] : parseFdOutput(stdout),
      ),
      Effect.orElseSucceed((): FdEntry[] => []),
      Effect.raceFirst(waitForAbort(signal)),
    );
  });
}
