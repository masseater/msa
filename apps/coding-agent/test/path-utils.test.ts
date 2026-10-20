import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { expandPath, resolveReadPath, resolveToCwd } from "../src/core/tools/path-utils.ts";

const { joinPath, makeTempDir, removePath, resolvePath, runTest, tempRoot, writeTextFile } =
  testing;

let tempDir: string;

const shouldExpandToHomeDirectory = () => {
  const result = expandPath("~");
  expect(result).not.toContain("~");
};

const shouldExpandPathToHomeDirectory = () => {
  const result = expandPath("~/Documents/file.txt");
  expect(result).not.toContain("~/");
};

const shouldKeepTildePrefixedFilenamesLiteral = () => {
  expect(expandPath("~draft.md")).toBe("~draft.md");
  expect(expandPath("@~draft.md")).toBe("~draft.md");
};

const shouldNormalizeUnicodeSpaces = () => {
  const withNBSP = "file\u00A0name.txt";
  const result = expandPath(withNBSP);
  expect(result).toBe("file name.txt");
};

const shouldResolveAbsolutePathsAsIs = () => {
  const absolutePath = resolvePath(tempRoot(), "absolute", "path", "file.txt");
  const result = resolveToCwd(absolutePath, resolvePath(tempRoot(), "some", "cwd"));
  expect(result).toBe(absolutePath);
};

const shouldResolveRelativePathsAgainstCwd = () => {
  const result = resolveToCwd("relative/file.txt", "/some/cwd");
  expect(result).toBe(resolvePath("/some/cwd", "relative/file.txt"));
};

const shouldResolveTildePrefixedFilenamesAgainstCwd = () => {
  const cwd = joinPath(tempRoot(), "msa-path-utils-cwd");
  expect(resolveToCwd("~draft.md", cwd)).toBe(resolvePath(cwd, "~draft.md"));
  expect(resolveToCwd("@~draft.md", cwd)).toBe(resolvePath(cwd, "~draft.md"));
};

const shouldResolveExistingFilePath = () =>
  runTest(
    Effect.gen(function* () {
      const fileName = "test-file.txt";
      yield* writeTextFile(joinPath(tempDir, fileName), "content");

      const result = resolveReadPath(fileName, tempDir);
      expect(result).toBe(joinPath(tempDir, fileName));
    }),
  );

const shouldHandleNfcVsNfdUnicodeNormalization = () =>
  runTest(
    Effect.gen(function* () {
      const nfdFileName = "file\u0065\u0301.txt";

      const nfcFileName = "file\u00e9.txt";

      expect(nfdFileName).not.toBe(nfcFileName);
      expect(Buffer.from(nfdFileName)).not.toEqual(Buffer.from(nfcFileName));

      yield* writeTextFile(joinPath(tempDir, nfdFileName), "content");

      const result = resolveReadPath(nfcFileName, tempDir);

      expect(result).toContain(tempDir);
      expect(result).toMatch(/file.+\.txt$/u);
    }),
  );

const shouldHandleCurlyQuotesVsStraightQuotes = () =>
  runTest(
    Effect.gen(function* () {
      const curlyQuoteName = "Capture d\u2019cran.txt";
      const straightQuoteName = "Capture d'cran.txt";

      expect(curlyQuoteName).not.toBe(straightQuoteName);

      yield* writeTextFile(joinPath(tempDir, curlyQuoteName), "content");

      const result = resolveReadPath(straightQuoteName, tempDir);
      expect(result).toBe(joinPath(tempDir, curlyQuoteName));
    }),
  );

const shouldHandleCombinedNfcCurlyQuoteFrench = () =>
  runTest(
    Effect.gen(function* () {
      const nfcCurlyName = "Capture d\u2019\u00e9cran.txt";
      const nfcStraightName = "Capture d'\u00e9cran.txt";

      expect(nfcCurlyName).not.toBe(nfcStraightName);

      yield* writeTextFile(joinPath(tempDir, nfcCurlyName), "content");

      const result = resolveReadPath(nfcStraightName, tempDir);
      expect(result).toBe(joinPath(tempDir, nfcCurlyName));
    }),
  );

const shouldHandleMacosScreenshotAmPmVariant = () =>
  runTest(
    Effect.gen(function* () {
      const macosName = "Screenshot 2024-01-01 at 10.00.00\u202FAM.png";
      const userName = "Screenshot 2024-01-01 at 10.00.00 AM.png";

      yield* writeTextFile(joinPath(tempDir, macosName), "content");

      const result = resolveReadPath(userName, tempDir);

      expect(result).toBe(joinPath(tempDir, macosName));
    }),
  );

const shouldHandleMacosScreenshotLowercaseAmPm = () =>
  runTest(
    Effect.gen(function* () {
      const macosName = "Screenshot 2024-01-01 at 10.00.00\u202Fam.png";
      const userName = "Screenshot 2024-01-01 at 10.00.00 am.png";

      yield* writeTextFile(joinPath(tempDir, macosName), "content");

      const result = resolveReadPath(userName, tempDir);

      expect(result).toBe(joinPath(tempDir, macosName));
    }),
  );

describe("path-utils", () => {
  describe("expandPath", () => {
    it("should expand ~ to home directory", shouldExpandToHomeDirectory);

    it("should expand ~/path to home directory", shouldExpandPathToHomeDirectory);

    it("should keep tilde-prefixed filenames literal", shouldKeepTildePrefixedFilenamesLiteral);

    it("should normalize Unicode spaces", shouldNormalizeUnicodeSpaces);
  });

  describe("resolveToCwd", () => {
    it("should resolve absolute paths as-is", shouldResolveAbsolutePathsAsIs);

    it("should resolve relative paths against cwd", shouldResolveRelativePathsAgainstCwd);

    it(
      "should resolve tilde-prefixed filenames against cwd",
      shouldResolveTildePrefixedFilenamesAgainstCwd,
    );
  });
});

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("path-utils-test-");
    }),
  );

describe("path-utils", () => {
  describe("resolveReadPath", () => {
    beforeEach(beforeEachHook);

    afterEach(() => runTest(removePath(tempDir)));

    it("should resolve existing file path", shouldResolveExistingFilePath);

    it(
      "should handle NFC vs NFD Unicode normalization (macOS filenames with accents)",
      shouldHandleNfcVsNfdUnicodeNormalization,
    );

    it(
      "should handle curly quotes vs straight quotes (macOS filenames)",
      shouldHandleCurlyQuotesVsStraightQuotes,
    );

    it(
      "should handle combined NFC + curly quote (French macOS screenshots)",
      shouldHandleCombinedNfcCurlyQuoteFrench,
    );

    it(
      "should handle macOS screenshot AM/PM variant with narrow no-break space",
      shouldHandleMacosScreenshotAmPmVariant,
    );

    it(
      "should handle macOS screenshot lowercase am/pm variant (en_AU locale)",
      shouldHandleMacosScreenshotLowercaseAmPm,
    );
  });
});
