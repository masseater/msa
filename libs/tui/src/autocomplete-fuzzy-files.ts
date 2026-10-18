import { Effect } from "effect";

import { type FdEntry, walkDirectoryWithFd } from "./autocomplete-fd.ts";
import { expandHomePath } from "./autocomplete-files.ts";
import { buildCompletionValue, toDisplayPath } from "./autocomplete-prefix.ts";
import type { AutocompleteItem } from "./autocomplete-types.ts";
import { pathOperations, Platform } from "./platform.ts";

const { basename, join } = pathOperations;

export interface FuzzyFileQuery {
  basePath: string;
  fdPath: string | null;
  query: string;
  isQuotedPrefix: boolean;
  signal: AbortSignal;
}

interface ScopedFuzzyQuery {
  baseDir: string;
  query: string;
  displayBase: string;
}

interface ScoredEntry extends FdEntry {
  score: number;
}

function resolveScopedFuzzyQuery(
  basePath: string,
  rawQuery: string,
): Effect.Effect<ScopedFuzzyQuery | null, never, Platform> {
  const normalizedQuery = toDisplayPath(rawQuery);
  const slashIndex = normalizedQuery.lastIndexOf("/");
  if (slashIndex === -1) {
    return Effect.succeed(null);
  }

  const displayBase = normalizedQuery.slice(0, slashIndex + 1);
  const query = normalizedQuery.slice(slashIndex + 1);

  let baseDir: string;
  if (displayBase.startsWith("~/")) {
    baseDir = expandHomePath(displayBase);
  } else if (displayBase.startsWith("/")) {
    baseDir = displayBase;
  } else {
    baseDir = join(basePath, displayBase);
  }

  return Platform.use((platform) => platform.isDirectory(baseDir)).pipe(
    Effect.map((isDirectory) => (isDirectory ? { baseDir, query, displayBase } : null)),
  );
}

function scopedPathForDisplay(displayBase: string, relativePath: string): string {
  const normalizedRelativePath = toDisplayPath(relativePath);
  if (displayBase === "/") {
    return `/${normalizedRelativePath}`;
  }
  return `${toDisplayPath(displayBase)}${normalizedRelativePath}`;
}

function scoreEntry(filePath: string, query: string, isDirectory: boolean): number {
  const lowerFileName = basename(filePath).toLowerCase();
  const lowerQuery = query.toLowerCase();

  let score = 0;

  if (lowerFileName === lowerQuery) score = 100;
  else if (lowerFileName.startsWith(lowerQuery)) score = 80;
  else if (lowerFileName.includes(lowerQuery)) score = 50;
  else if (filePath.toLowerCase().includes(lowerQuery)) score = 30;

  if (isDirectory && score > 0) score += 10;

  return score;
}

function pathDepth(path: string): number {
  return toDisplayPath(path).split("/").filter(Boolean).length;
}

function compareScoredEntries(a: ScoredEntry, b: ScoredEntry): number {
  const scoreDiff = b.score - a.score;
  if (scoreDiff !== 0) return scoreDiff;

  const depthDiff = pathDepth(a.path) - pathDepth(b.path);
  if (depthDiff !== 0) return depthDiff;

  const lengthDiff = a.path.length - b.path.length;
  if (lengthDiff !== 0) return lengthDiff;

  return a.path.localeCompare(b.path);
}

function mergeEntries(baseDirEntries: FdEntry[], recursiveEntries: FdEntry[]): FdEntry[] {
  const seenPaths = new Set(baseDirEntries.map((entry) => entry.path));
  return [
    ...baseDirEntries,
    ...recursiveEntries.filter((entry) => {
      if (seenPaths.has(entry.path)) return false;
      seenPaths.add(entry.path);
      return true;
    }),
  ];
}

function rankEntries(entries: FdEntry[], fdQuery: string): ScoredEntry[] {
  return entries
    .map((entry) => ({
      path: entry.path,
      isDirectory: entry.isDirectory,
      score: fdQuery === "" ? 1 : scoreEntry(entry.path, fdQuery, entry.isDirectory),
    }))
    .filter((entry) => entry.score > 0)
    .sort(compareScoredEntries)
    .slice(0, 20);
}

function toSuggestion(
  entry: FdEntry,
  scopedQuery: ScopedFuzzyQuery | null,
  isQuotedPrefix: boolean,
): AutocompleteItem {
  const pathWithoutSlash = entry.isDirectory ? entry.path.slice(0, -1) : entry.path;
  const displayPath =
    scopedQuery === null
      ? pathWithoutSlash
      : scopedPathForDisplay(scopedQuery.displayBase, pathWithoutSlash);
  const completionPath = entry.isDirectory ? `${displayPath}/` : displayPath;
  return {
    value: buildCompletionValue({ path: completionPath, isAtPrefix: true, isQuotedPrefix }),
    label: basename(pathWithoutSlash) + (entry.isDirectory ? "/" : ""),
    description: displayPath,
  };
}

const searchFuzzyFiles = Effect.fnUntraced(function* (input: FuzzyFileQuery, fdPath: string) {
  const scopedQuery = yield* resolveScopedFuzzyQuery(input.basePath, input.query);
  const baseDir = scopedQuery?.baseDir ?? input.basePath;
  const query = scopedQuery?.query ?? input.query;
  const walk = { baseDir, fdPath, query, maxResults: 100, signal: input.signal };
  const baseDirEntries = input.signal.aborted
    ? []
    : yield* walkDirectoryWithFd({ ...walk, maxDepth: 1 });
  const recursiveEntries = yield* walkDirectoryWithFd(walk);
  if (input.signal.aborted) {
    return [];
  }
  return rankEntries(mergeEntries(baseDirEntries, recursiveEntries), query).map((entry) =>
    toSuggestion(entry, scopedQuery, input.isQuotedPrefix),
  );
});

export function getFuzzyFileSuggestions(
  input: FuzzyFileQuery,
): Effect.Effect<AutocompleteItem[], never, Platform> {
  const { fdPath } = input;
  if (fdPath === null || fdPath === "" || input.signal.aborted) {
    return Effect.succeed([]);
  }
  return searchFuzzyFiles(input, fdPath).pipe(Effect.catchDefect(() => Effect.succeed([])));
}
