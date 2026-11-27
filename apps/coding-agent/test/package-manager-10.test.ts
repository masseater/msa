import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import packageManagerFixture from "./package-manager-fixture.ts";
import parsedSource from "./parsed-source.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { asGit } = parsedSource;

const { joinPath, makeDirectory, runTest, writeTextFile } = testing;

const shouldDeduplicateGitUrlsWithDifferentSupported = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "https-dedup-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "test.ts"),
        "export default function() {}",
      );

      fixture.settingsManager.resources.setPackages([
        "https://github.com/user/repo",
        "git:github.com/user/repo",
        "https://github.com/user/repo.git",
      ]);

      const id1 = fixture.packageManager.sources.getPackageIdentity("https://github.com/user/repo");
      const id2 = fixture.packageManager.sources.getPackageIdentity("git:github.com/user/repo");
      const id3 = fixture.packageManager.sources.getPackageIdentity(
        "https://github.com/user/repo.git",
      );

      expect(id1).toBe(id2);
      expect(id2).toBe(id3);
    }),
  );

const shouldHandleHttpsUrlsWithRefsIn = () =>
  runTest(
    Effect.sync(() => {
      const parsed = asGit(
        fixture.packageManager.sources.parseSource("https://github.com/user/repo@main"),
      );
      expect(parsed.ref).toBe("main");
      expect(parsed.pinned).toBe(true);

      const parsed2 = asGit(
        fixture.packageManager.sources.parseSource("https://github.com/user/repo@feature/branch"),
      );
      expect(parsed2.ref).toBe("feature/branch");
    }),
  );

describe("DefaultPackageManager", () => {
  describe("HTTPS git URL parsing (old behavior)", () => {
    it(
      "should deduplicate git URLs with different supported formats",
      shouldDeduplicateGitUrlsWithDifferentSupported,
    );

    it("should handle HTTPS URLs with refs in resolve", shouldHandleHttpsUrlsWithRefsIn);
  });
});
