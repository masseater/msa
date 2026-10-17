import { spawn } from "child_process";

import { Effect } from "effect";

import { toDisplayPath } from "./autocomplete-prefix.ts";

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

export function walkDirectoryWithFd(options: FdWalkOptions): Effect.Effect<FdEntry[]> {
  const args = buildFdArgs(options);
  const { signal } = options;
  return Effect.callback<FdEntry[]>((resume) => {
    if (signal.aborted) {
      resume(Effect.succeed([]));
      return;
    }

    const child = spawn(options.fdPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let resolved = false;

    const onAbort = (): void => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    };

    const finish = (results: FdEntry[]): void => {
      if (resolved) return;
      resolved = true;
      signal.removeEventListener("abort", onAbort);
      resume(Effect.succeed(results));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => {
      finish([]);
    });
    child.on("close", (code) => {
      if (signal.aborted || code !== 0 || stdout === "") {
        finish([]);
        return;
      }
      finish(parseFdOutput(stdout));
    });
  });
}
