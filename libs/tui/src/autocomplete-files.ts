import { type Dirent, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";

import { Effect } from "effect";

import { buildCompletionValue, parsePathPrefix, toDisplayPath } from "./autocomplete-prefix.ts";
import type { AutocompleteItem } from "./autocomplete-types.ts";
import { pathOperations } from "./platform.ts";

const { basename, dirname, join } = pathOperations;

export interface FileSuggestionContext {
  basePath: string;
  prefix: string;
}

interface SearchLocation {
  searchDir: string;
  searchPrefix: string;
}

export function expandHomePath(path: string): string {
  if (path.startsWith("~/")) {
    const expandedPath = join(homedir(), path.slice(2));
    return path.endsWith("/") && !expandedPath.endsWith("/") ? `${expandedPath}/` : expandedPath;
  } else if (path === "~") {
    return homedir();
  }
  return path;
}

function resolveSearchLocation(context: {
  basePath: string;
  rawPrefix: string;
  isAtPrefix: boolean;
}): SearchLocation {
  const { basePath, rawPrefix, isAtPrefix } = context;
  const expandedPrefix = rawPrefix.startsWith("~") ? expandHomePath(rawPrefix) : rawPrefix;
  const isAbsolute = rawPrefix.startsWith("~") || expandedPrefix.startsWith("/");

  const isRootPrefix =
    rawPrefix === "" ||
    rawPrefix === "./" ||
    rawPrefix === "../" ||
    rawPrefix === "~" ||
    rawPrefix === "~/" ||
    rawPrefix === "/" ||
    (isAtPrefix && rawPrefix === "");

  if (isRootPrefix || rawPrefix.endsWith("/")) {
    return {
      searchDir: isAbsolute ? expandedPrefix : join(basePath, expandedPrefix),
      searchPrefix: "",
    };
  }
  const dir = dirname(expandedPrefix);
  return {
    searchDir: isAbsolute ? dir : join(basePath, dir),
    searchPrefix: basename(expandedPrefix),
  };
}

function nestedRelativePath(displayPrefix: string, name: string): string {
  if (displayPrefix.startsWith("~/")) {
    const dir = dirname(displayPrefix.slice(2));
    return `~/${dir === "." ? name : join(dir, name)}`;
  }
  if (displayPrefix.startsWith("/")) {
    const dir = dirname(displayPrefix);
    return dir === "/" ? `/${name}` : `${dir}/${name}`;
  }
  const relativePath = join(dirname(displayPrefix), name);
  return displayPrefix.startsWith("./") && !relativePath.startsWith("./")
    ? `./${relativePath}`
    : relativePath;
}

function relativeEntryPath(displayPrefix: string, name: string): string {
  if (displayPrefix.endsWith("/")) {
    return displayPrefix + name;
  }
  if (displayPrefix.includes("/") || displayPrefix.includes("\\")) {
    return nestedRelativePath(displayPrefix, name);
  }
  return displayPrefix.startsWith("~") ? `~/${name}` : name;
}

function compareDirectoriesFirst(a: AutocompleteItem, b: AutocompleteItem): number {
  const aIsDir = a.label.endsWith("/");
  const bIsDir = b.label.endsWith("/");
  if (aIsDir && !bIsDir) return -1;
  if (!aIsDir && bIsDir) return 1;
  return a.label.localeCompare(b.label);
}

function isDirectoryEntry(searchDir: string, entry: Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return statSync(join(searchDir, entry.name)).isDirectory();
  } catch {
    return false;
  }
}

function listFileSuggestions(context: FileSuggestionContext): AutocompleteItem[] {
  const { rawPrefix, isAtPrefix, isQuotedPrefix } = parsePathPrefix(context.prefix);
  const { searchDir, searchPrefix } = resolveSearchLocation({
    basePath: context.basePath,
    rawPrefix,
    isAtPrefix,
  });

  const suggestions: AutocompleteItem[] = [];
  for (const entry of readdirSync(searchDir, { withFileTypes: true })) {
    if (!entry.name.toLowerCase().startsWith(searchPrefix.toLowerCase())) {
      continue;
    }
    const isDirectory = isDirectoryEntry(searchDir, entry);
    const relativePath = toDisplayPath(relativeEntryPath(rawPrefix, entry.name));
    suggestions.push({
      value: buildCompletionValue({
        path: isDirectory ? `${relativePath}/` : relativePath,
        isAtPrefix,
        isQuotedPrefix,
      }),
      label: entry.name + (isDirectory ? "/" : ""),
    });
  }

  return suggestions.sort(compareDirectoriesFirst);
}

export function getFileSuggestions(
  context: FileSuggestionContext,
): Effect.Effect<AutocompleteItem[]> {
  return Effect.sync(() => listFileSuggestions(context)).pipe(
    Effect.catchDefect(() => Effect.succeed([])),
  );
}
