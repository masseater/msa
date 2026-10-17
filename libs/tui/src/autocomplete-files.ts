import { homedir } from "node:os";

import { Effect } from "effect";

import { buildCompletionValue, parsePathPrefix, toDisplayPath } from "./autocomplete-prefix.ts";
import type { AutocompleteItem } from "./autocomplete-types.ts";
import { Platform, pathOperations } from "./platform.ts";

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

function suggestionFor(
  rawPrefix: string,
  flags: { isAtPrefix: boolean; isQuotedPrefix: boolean },
): (entry: { name: string; isDirectory: boolean }) => AutocompleteItem {
  return ({ name, isDirectory }) => {
    const relativePath = toDisplayPath(relativeEntryPath(rawPrefix, name));
    return {
      value: buildCompletionValue({
        path: isDirectory ? `${relativePath}/` : relativePath,
        ...flags,
      }),
      label: name + (isDirectory ? "/" : ""),
    };
  };
}

export function getFileSuggestions(
  context: FileSuggestionContext,
): Effect.Effect<AutocompleteItem[], never, Platform> {
  const { rawPrefix, isAtPrefix, isQuotedPrefix } = parsePathPrefix(context.prefix);
  const { searchDir, searchPrefix } = resolveSearchLocation({
    basePath: context.basePath,
    rawPrefix,
    isAtPrefix,
  });
  return Effect.gen(function* () {
    const platform = yield* Platform;
    const names = yield* platform.readDirectory(searchDir);
    const entries = yield* Effect.forEach(
      names.filter((name) => name.toLowerCase().startsWith(searchPrefix.toLowerCase())),
      (name) =>
        platform
          .isDirectory(join(searchDir, name))
          .pipe(Effect.map((isDirectory) => ({ name, isDirectory }))),
    );
    return entries
      .map(suggestionFor(rawPrefix, { isAtPrefix, isQuotedPrefix }))
      .sort(compareDirectoriesFirst);
  }).pipe(Effect.orElseSucceed((): AutocompleteItem[] => []));
}
