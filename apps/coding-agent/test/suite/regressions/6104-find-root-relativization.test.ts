import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import find from "../../../src/core/tools/find.ts";

const { createFindToolDefinition, relativizeFindResultPath } = find;

interface PathFns {
  readonly sep: string;
  readonly isAbsolute: (value: string) => boolean;
  readonly relative: (from: string, to: string) => string;
}

const makePathFns = (sep: string, caseInsensitive: boolean): PathFns => {
  const split = (value: string): string[] =>
    value.split(sep === "\\" ? /[\\/]+/u : "/").filter((segment) => segment !== "");
  const fold = (value: string): string => (caseInsensitive ? value.toLowerCase() : value);
  return {
    isAbsolute: (value) =>
      sep === "\\"
        ? /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\")
        : value.startsWith("/"),
    relative: (from, to) => {
      const fromParts = split(from);
      const toParts = split(to);
      let shared = 0;
      while (
        shared < fromParts.length &&
        shared < toParts.length &&
        fold(fromParts[shared] ?? "") === fold(toParts[shared] ?? "")
      ) {
        shared += 1;
      }
      const up = Array.from({ length: fromParts.length - shared }, () => "..");
      return [...up, ...toParts.slice(shared)].join(sep);
    },
    sep,
  };
};

const asPlatformPath = (fns: PathFns): Parameters<typeof relativizeFindResultPath>[2] =>
  fns as unknown as Parameters<typeof relativizeFindResultPath>[2];

const win32 = asPlatformPath(makePathFns("\\", true));
const posix = asPlatformPath(makePathFns("/", false));

const searchRoot = "I:\\";

const relativizesCustomGlobResultsAgainstA = Effect.gen(function* () {
  const def = createFindToolDefinition("/", {
    operations: {
      exists: () => true,
      glob: () => ["/home/user/project/", "/home/user/project/file.txt"],
    },
  });

  const ctx = {} as Parameters<typeof def.execute>[4];
  const result = (yield* Effect.promise(() =>
    def.execute("call-1", { pattern: "**" }, undefined, undefined, ctx),
  )) as {
    content: Array<{ type: string; text?: string }>;
  };
  expect(result.content[0]?.text).toBe("home/user/project/\nhome/user/project/file.txt");
});

const relativizeCases = [
  {
    expected: "AI/Models/TextGen/gemma4/",
    group: "Windows drive root",
    name: "preserves the first segment and emits one trailing slash for fd directory output",
    path: "I:\\AI\\Models\\TextGen\\gemma4\\",
    platform: win32,
    root: searchRoot,
  },
  {
    expected: "AI/Models/TextGen/gemma4/",
    group: "Windows drive root",
    name: "handles fd output that uses forward slashes under a drive root",
    path: "I:/AI/Models/TextGen/gemma4/",
    platform: win32,
    root: searchRoot,
  },
  {
    expected: "Models/",
    group: "Windows drive root",
    name: "keeps deeper search paths unchanged",
    path: "I:\\AI\\Models\\",
    platform: win32,
    root: "I:\\AI",
  },
  {
    expected: "../Models2/file.txt",
    group: "Windows drive root",
    name: "does not relativize a sibling directory that shares a name prefix",
    path: "I:\\AI\\Models2\\file.txt",
    platform: win32,
    root: "I:\\AI\\Models",
  },
  {
    expected: "AI/Models/TextGen/gemma4/",
    group: "Windows drive root",
    name: "normalizes relative custom-glob results without corrupting them",
    path: "AI\\Models\\TextGen\\gemma4\\",
    platform: win32,
    root: searchRoot,
  },
  {
    expected: "home/user/file.txt",
    group: "POSIX root",
    name: "preserves the first segment for files under /",
    path: "/home/user/file.txt",
    platform: posix,
    root: "/",
  },
  {
    expected: "home/user/project/",
    group: "POSIX root",
    name: "preserves the first segment and one trailing slash for directories under /",
    path: "/home/user/project/",
    platform: posix,
    root: "/",
  },
  {
    expected: "file\\",
    group: "POSIX root",
    name: "preserves backslashes in POSIX filenames",
    path: "/home/user/file\\",
    platform: posix,
    root: "/home/user",
  },
  {
    expected: "../../tmp/results/file.txt",
    group: "absolute results outside the search path",
    name: "falls back to path.relative when the absolute paths do not share a prefix",
    path: "/tmp/results/file.txt",
    platform: posix,
    root: "/workspace/project",
  },
  {
    expected: "../../tmp/results/dir/",
    group: "absolute results outside the search path",
    name: "keeps a trailing slash on directories resolved through path.relative",
    path: "/tmp/results/dir/",
    platform: posix,
    root: "/workspace/project",
  },
];

const relativizesCustomGlobResultsAgainstARoot = () =>
  Effect.runPromise(relativizesCustomGlobResultsAgainstA);

describe("issue #6104 find relativizes root search paths", () => {
  it.each(relativizeCases)("$group $name", ({ expected, path, platform, root }) => {
    expect(relativizeFindResultPath(path, root, platform)).toBe(expected);
  });

  describe("through the find tool", () => {
    it(
      "relativizes custom glob results against a root search path",
      relativizesCustomGlobResultsAgainstARoot,
    );
  });
});
