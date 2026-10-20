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

const preservesTheFirstSegmentAndEmitsOne = () => {
  expect(relativizeFindResultPath("I:\\AI\\Models\\TextGen\\gemma4\\", searchRoot, win32)).toBe(
    "AI/Models/TextGen/gemma4/",
  );
};

const handlesFdOutputThatUsesForwardSlashes = () => {
  expect(relativizeFindResultPath("I:/AI/Models/TextGen/gemma4/", searchRoot, win32)).toBe(
    "AI/Models/TextGen/gemma4/",
  );
};

const keepsDeeperSearchPathsUnchanged = () => {
  expect(relativizeFindResultPath("I:\\AI\\Models\\", "I:\\AI", win32)).toBe("Models/");
};

const doesNotRelativizeASiblingDirectoryThat = () => {
  expect(relativizeFindResultPath("I:\\AI\\Models2\\file.txt", "I:\\AI\\Models", win32)).toBe(
    "../Models2/file.txt",
  );
};

const normalizesRelativeCustomGlobResultsWithoutCorrupting = () => {
  expect(relativizeFindResultPath("AI\\Models\\TextGen\\gemma4\\", searchRoot, win32)).toBe(
    "AI/Models/TextGen/gemma4/",
  );
};

const preservesTheFirstSegmentForFilesUnder = () => {
  expect(relativizeFindResultPath("/home/user/file.txt", "/", posix)).toBe("home/user/file.txt");
};

const preservesTheFirstSegmentAndOneTrailing = () => {
  expect(relativizeFindResultPath("/home/user/project/", "/", posix)).toBe("home/user/project/");
};

const preservesBackslashesInPosixFilenames = () => {
  expect(relativizeFindResultPath("/home/user/file\\", "/home/user", posix)).toBe("file\\");
};

const fallsBackToPathRelativeWhenThe = () => {
  expect(relativizeFindResultPath("/tmp/results/file.txt", "/workspace/project", posix)).toBe(
    "../../tmp/results/file.txt",
  );
};

const keepsATrailingSlashOnDirectoriesResolved = () => {
  expect(relativizeFindResultPath("/tmp/results/dir/", "/workspace/project", posix)).toBe(
    "../../tmp/results/dir/",
  );
};

const relativizesCustomGlobResultsAgainstARoot = () =>
  Effect.runPromise(relativizesCustomGlobResultsAgainstA);

describe("issue #6104 find relativizes root search paths", () => {
  describe("Windows drive root", () => {
    it(
      "preserves the first segment and emits one trailing slash for fd directory output",
      preservesTheFirstSegmentAndEmitsOne,
    );
    it(
      "handles fd output that uses forward slashes under a drive root",
      handlesFdOutputThatUsesForwardSlashes,
    );
    it("keeps deeper search paths unchanged", keepsDeeperSearchPathsUnchanged);
    it(
      "does not relativize a sibling directory that shares a name prefix",
      doesNotRelativizeASiblingDirectoryThat,
    );
    it(
      "normalizes relative custom-glob results without corrupting them",
      normalizesRelativeCustomGlobResultsWithoutCorrupting,
    );
  });
  describe("POSIX root", () => {
    it("preserves the first segment for files under /", preservesTheFirstSegmentForFilesUnder);
    it(
      "preserves the first segment and one trailing slash for directories under /",
      preservesTheFirstSegmentAndOneTrailing,
    );
    it("preserves backslashes in POSIX filenames", preservesBackslashesInPosixFilenames);
  });
  describe("absolute results outside the search path", () => {
    it(
      "falls back to path.relative when the absolute paths do not share a prefix",
      fallsBackToPathRelativeWhenThe,
    );
    it(
      "keeps a trailing slash on directories resolved through path.relative",
      keepsATrailingSlashOnDirectoriesResolved,
    );
  });
  describe("through the find tool", () => {
    it(
      "relativizes custom glob results against a root search path",
      relativizesCustomGlobResultsAgainstARoot,
    );
  });
});
