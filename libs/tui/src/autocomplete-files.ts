import { homedir } from "node:os";

import { Effect } from "effect";

import type autocompleteFilesTypes from "./autocomplete-files.types.ts";
import autocompletePrefix from "./autocomplete-prefix.ts";
import type autocompleteTypesModule from "./autocomplete-types.ts";
import platformModule from "./platform.ts";
import type platformTypes from "./platform.types.ts";

const { Platform, pathOperations } = platformModule;
const { buildCompletionValue, parsePathPrefix, toDisplayPath } = autocompletePrefix;

const { basename, dirname, join } = pathOperations;

interface SearchLocation {
  searchDir: string;
  searchPrefix: string;
}

function expandHomePath(path: string): string {
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

function compareDirectoriesFirst(
  a: autocompleteTypesModule.AutocompleteItem,
  b: autocompleteTypesModule.AutocompleteItem,
): number {
  const aIsDir = a.label.endsWith("/");
  const bIsDir = b.label.endsWith("/");
  if (aIsDir && !bIsDir) return -1;
  if (!aIsDir && bIsDir) return 1;
  return a.label.localeCompare(b.label);
}

function suggestionFor(
  rawPrefix: string,
  flags: { isAtPrefix: boolean; isQuotedPrefix: boolean },
): (entry: { name: string; isDirectory: boolean }) => autocompleteTypesModule.AutocompleteItem {
  return ({ name, isDirectory }) => {
    const relativePath = toDisplayPath(relativeEntryPath(rawPrefix, name));
    return {
      label: name + (isDirectory ? "/" : ""),
      value: buildCompletionValue({
        path: isDirectory ? `${relativePath}/` : relativePath,
        ...flags,
      }),
    };
  };
}

function getFileSuggestions(
  context: autocompleteFilesTypes.FileSuggestionContext,
): Effect.Effect<autocompleteTypesModule.AutocompleteItem[], never, platformTypes.Platform> {
  const { rawPrefix, isAtPrefix, isQuotedPrefix } = parsePathPrefix(context.prefix);
  const { searchDir, searchPrefix } = resolveSearchLocation({
    basePath: context.basePath,
    isAtPrefix,
    rawPrefix,
  });
  return Effect.gen(function* () {
    const platform = yield* Platform;
    const names = yield* platform.readDirectory(searchDir);
    const entries = yield* Effect.forEach(
      names.filter((name) => name.toLowerCase().startsWith(searchPrefix.toLowerCase())),
      (name) =>
        platform
          .isDirectory(join(searchDir, name))
          .pipe(Effect.map((isDirectory) => ({ isDirectory, name }))),
    );
    return entries
      .map(suggestionFor(rawPrefix, { isAtPrefix, isQuotedPrefix }))
      .sort(compareDirectoriesFirst);
  }).pipe(Effect.orElseSucceed((): autocompleteTypesModule.AutocompleteItem[] => []));
}

const autocompleteFiles = {
  expandHomePath,
  getFileSuggestions,
};

export default autocompleteFiles;
