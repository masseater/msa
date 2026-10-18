import {
  joinPath,
  makeTempDir,
  removePath,
  resolvePath,
  runTest,
  tempRoot,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { expandPath, resolveReadPath, resolveToCwd } from "../src/core/tools/path-utils.ts";

describe("path-utils", () => {
  describe("expandPath", () => {
    it("should expand ~ to home directory", () => {
      const result = expandPath("~");
      expect(result).not.toContain("~");
    });

    it("should expand ~/path to home directory", () => {
      const result = expandPath("~/Documents/file.txt");
      expect(result).not.toContain("~/");
    });

    it("should keep tilde-prefixed filenames literal", () => {
      expect(expandPath("~draft.md")).toBe("~draft.md");
      expect(expandPath("@~draft.md")).toBe("~draft.md");
    });

    it("should normalize Unicode spaces", () => {
      const withNBSP = "file\u00A0name.txt";
      const result = expandPath(withNBSP);
      expect(result).toBe("file name.txt");
    });
  });

  describe("resolveToCwd", () => {
    it("should resolve absolute paths as-is", () => {
      const absolutePath = resolvePath(tempRoot(), "absolute", "path", "file.txt");
      const result = resolveToCwd(absolutePath, resolvePath(tempRoot(), "some", "cwd"));
      expect(result).toBe(absolutePath);
    });

    it("should resolve relative paths against cwd", () => {
      const result = resolveToCwd("relative/file.txt", "/some/cwd");
      expect(result).toBe(resolvePath("/some/cwd", "relative/file.txt"));
    });

    it("should resolve tilde-prefixed filenames against cwd", () => {
      const cwd = joinPath(tempRoot(), "msa-path-utils-cwd");
      expect(resolveToCwd("~draft.md", cwd)).toBe(resolvePath(cwd, "~draft.md"));
      expect(resolveToCwd("@~draft.md", cwd)).toBe(resolvePath(cwd, "~draft.md"));
    });
  });

  describe("resolveReadPath", () => {
    let tempDir: string;

    beforeEach(() =>
      runTest(
        Effect.gen(function* () {
          tempDir = yield* makeTempDir("path-utils-test-");
        }),
      ),
    );

    afterEach(() => runTest(removePath(tempDir)));

    it("should resolve existing file path", () =>
      runTest(
        Effect.gen(function* () {
          const fileName = "test-file.txt";
          yield* writeTextFile(joinPath(tempDir, fileName), "content");

          const result = resolveReadPath(fileName, tempDir);
          expect(result).toBe(joinPath(tempDir, fileName));
        }),
      ));

    it("should handle NFC vs NFD Unicode normalization (macOS filenames with accents)", () =>
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
      ));

    it("should handle curly quotes vs straight quotes (macOS filenames)", () =>
      runTest(
        Effect.gen(function* () {
          const curlyQuoteName = "Capture d\u2019cran.txt";
          const straightQuoteName = "Capture d'cran.txt";

          expect(curlyQuoteName).not.toBe(straightQuoteName);

          yield* writeTextFile(joinPath(tempDir, curlyQuoteName), "content");

          const result = resolveReadPath(straightQuoteName, tempDir);
          expect(result).toBe(joinPath(tempDir, curlyQuoteName));
        }),
      ));

    it("should handle combined NFC + curly quote (French macOS screenshots)", () =>
      runTest(
        Effect.gen(function* () {
          const nfcCurlyName = "Capture d\u2019\u00e9cran.txt";
          const nfcStraightName = "Capture d'\u00e9cran.txt";

          expect(nfcCurlyName).not.toBe(nfcStraightName);

          yield* writeTextFile(joinPath(tempDir, nfcCurlyName), "content");

          const result = resolveReadPath(nfcStraightName, tempDir);
          expect(result).toBe(joinPath(tempDir, nfcCurlyName));
        }),
      ));

    it("should handle macOS screenshot AM/PM variant with narrow no-break space", () =>
      runTest(
        Effect.gen(function* () {
          const macosName = "Screenshot 2024-01-01 at 10.00.00\u202FAM.png";
          const userName = "Screenshot 2024-01-01 at 10.00.00 AM.png";

          yield* writeTextFile(joinPath(tempDir, macosName), "content");

          const result = resolveReadPath(userName, tempDir);

          expect(result).toBe(joinPath(tempDir, macosName));
        }),
      ));

    it("should handle macOS screenshot lowercase am/pm variant (en_AU locale)", () =>
      runTest(
        Effect.gen(function* () {
          const macosName = "Screenshot 2024-01-01 at 10.00.00\u202Fam.png";
          const userName = "Screenshot 2024-01-01 at 10.00.00 am.png";

          yield* writeTextFile(joinPath(tempDir, macosName), "content");

          const result = resolveReadPath(userName, tempDir);

          expect(result).toBe(joinPath(tempDir, macosName));
        }),
      ));
  });
});
