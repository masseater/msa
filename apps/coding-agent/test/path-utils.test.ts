import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import pathUtils from "../src/core/tools/path-utils.ts";
import tempDirKit from "./temp-dir.ts";

const { expandPath, resolveReadPath, resolveToCwd } = pathUtils;

const { awaited, joinPath, resolvePath, runTest, tempRoot, writeTextFile } = testing;

const { useTempDir } = tempDirKit;

const temp = useTempDir("path-utils-test-");

const shouldHandleNfcVsNfdUnicodeNormalization = () =>
  runTest(
    Effect.gen(function* () {
      const nfdFileName = "file\u0065\u0301.txt";

      const nfcFileName = "file\u00e9.txt";

      expect(nfdFileName).not.toBe(nfcFileName);
      expect(Buffer.from(nfdFileName)).not.toEqual(Buffer.from(nfcFileName));

      yield* writeTextFile(joinPath(temp.path, nfdFileName), "content");

      const result = yield* awaited(resolveReadPath(nfcFileName, temp.path));

      expect(result).toContain(temp.path);
      expect(result).toMatch(/file.+\.txt$/u);
    }),
  );

const homeCases = [
  { forbidden: "~", input: "~", name: "should expand ~ to home directory" },
  {
    forbidden: "~/",
    input: "~/Documents/file.txt",
    name: "should expand ~/path to home directory",
  },
];

const literalCases = [
  {
    expected: "~draft.md",
    inputs: ["~draft.md", "@~draft.md"],
    name: "should keep tilde-prefixed filenames literal",
  },
  {
    expected: "file name.txt",
    inputs: ["file\u00A0name.txt"],
    name: "should normalize Unicode spaces",
  },
];

const cwdCases = [
  {
    cwd: () => resolvePath(tempRoot(), "some", "cwd"),
    expected: () => resolvePath(tempRoot(), "absolute", "path", "file.txt"),
    inputs: () => [resolvePath(tempRoot(), "absolute", "path", "file.txt")],
    name: "should resolve absolute paths as-is",
  },
  {
    cwd: () => "/some/cwd",
    expected: () => resolvePath("/some/cwd", "relative/file.txt"),
    inputs: () => ["relative/file.txt"],
    name: "should resolve relative paths against cwd",
  },
  {
    cwd: () => joinPath(tempRoot(), "msa-path-utils-cwd"),
    expected: () => resolvePath(joinPath(tempRoot(), "msa-path-utils-cwd"), "~draft.md"),
    inputs: () => ["~draft.md", "@~draft.md"],
    name: "should resolve tilde-prefixed filenames against cwd",
  },
];

const readPathCases = [
  {
    actual: "test-file.txt",
    name: "should resolve existing file path",
    requested: "test-file.txt",
  },
  {
    actual: "Capture d\u2019cran.txt",
    name: "should handle curly quotes vs straight quotes (macOS filenames)",
    requested: "Capture d'cran.txt",
  },
  {
    actual: "Capture d\u2019\u00e9cran.txt",
    name: "should handle combined NFC + curly quote (French macOS screenshots)",
    requested: "Capture d'\u00e9cran.txt",
  },
  {
    actual: "Screenshot 2024-01-01 at 10.00.00\u202FAM.png",
    name: "should handle macOS screenshot AM/PM variant with narrow no-break space",
    requested: "Screenshot 2024-01-01 at 10.00.00 AM.png",
  },
  {
    actual: "Screenshot 2024-01-01 at 10.00.00\u202Fam.png",
    name: "should handle macOS screenshot lowercase am/pm variant (en_AU locale)",
    requested: "Screenshot 2024-01-01 at 10.00.00 am.png",
  },
];

describe("path-utils", () => {
  describe("expandPath", () => {
    it.each(homeCases)("$name", ({ forbidden, input }) => {
      expect(expandPath(input)).not.toContain(forbidden);
    });

    it.each(literalCases)("$name", ({ expected, inputs }) => {
      for (const input of inputs) {
        expect(expandPath(input)).toBe(expected);
      }
    });
  });

  describe("resolveToCwd", () => {
    it.each(cwdCases)("$name", ({ cwd, expected, inputs }) => {
      for (const input of inputs()) {
        expect(resolveToCwd(input, cwd())).toBe(expected());
      }
    });
  });

  describe("resolveReadPath", () => {
    it.each(readPathCases)("$name", ({ actual, requested }) =>
      runTest(
        Effect.gen(function* () {
          yield* writeTextFile(joinPath(temp.path, actual), "content");

          const result = yield* awaited(resolveReadPath(requested, temp.path));
          expect(result).toBe(joinPath(temp.path, actual));
        }),
      ),
    );

    it(
      "should handle NFC vs NFD Unicode normalization (macOS filenames with accents)",
      shouldHandleNfcVsNfdUnicodeNormalization,
    );
  });
});
