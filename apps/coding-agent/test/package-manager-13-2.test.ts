import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import packageManagerFixture from "./package-manager-fixture.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { awaited, joinPath, makeDirectory, runTest, writeTextFile } = testing;

const shouldDedupeSameLocalPackageInGlobal = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "shared-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "shared.ts"),
        "export default function() {}",
      );

      fixture.settingsManager.resources.setPackages([pkgDir]);
      fixture.settingsManager.resources.setProjectPackages([pkgDir]);

      const globalSettings = fixture.settingsManager.getGlobalSettings();
      const projectSettings = fixture.settingsManager.getProjectSettings();
      expect(globalSettings.packages).toEqual([pkgDir]);
      expect(projectSettings.packages).toEqual([pkgDir]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());

      const sharedPaths = result.extensions.filter((r) => r.path.includes("shared-pkg"));
      expect(sharedPaths.length).toBe(1);
      expect(sharedPaths[0]?.metadata.scope).toBe("project");
    }),
  );

const shouldKeepBothIfDifferentPackages = () =>
  runTest(
    Effect.gen(function* () {
      const pkg1Dir = joinPath(fixture.tempDir, "pkg1");
      const pkg2Dir = joinPath(fixture.tempDir, "pkg2");
      yield* makeDirectory(joinPath(pkg1Dir, "extensions"));
      yield* makeDirectory(joinPath(pkg2Dir, "extensions"));
      yield* writeTextFile(
        joinPath(pkg1Dir, "extensions", "from-pkg1.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkg2Dir, "extensions", "from-pkg2.ts"),
        "export default function() {}",
      );

      fixture.settingsManager.resources.setPackages([pkg1Dir]);
      fixture.settingsManager.resources.setProjectPackages([pkg2Dir]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.extensions.some((r) => r.path.includes("pkg1"))).toBe(true);
      expect(result.extensions.some((r) => r.path.includes("pkg2"))).toBe(true);
    }),
  );

const shouldDedupeSshAndHttpsUrlsFor = () =>
  runTest(
    Effect.sync(() => {
      const httpsUrl = "https://github.com/user/repo";
      const sshUrl = "git:git@github.com:user/repo";

      const httpsIdentity = fixture.packageManager.sources.getPackageIdentity(httpsUrl);
      const sshIdentity = fixture.packageManager.sources.getPackageIdentity(sshUrl);

      expect(httpsIdentity).toBe("git:github.com/user/repo");
      expect(sshIdentity).toBe("git:github.com/user/repo");
      expect(httpsIdentity).toBe(sshIdentity);
    }),
  );

const shouldDedupeSshAndHttpsWithRefs = () =>
  runTest(
    Effect.sync(() => {
      const httpsUrl = "https://github.com/user/repo@v1.0.0";
      const sshUrl = "git:git@github.com:user/repo@v1.0.0";

      const httpsIdentity = fixture.packageManager.sources.getPackageIdentity(httpsUrl);
      const sshIdentity = fixture.packageManager.sources.getPackageIdentity(sshUrl);

      expect(httpsIdentity).toBe("git:github.com/user/repo");
      expect(sshIdentity).toBe("git:github.com/user/repo");
      expect(httpsIdentity).toBe(sshIdentity);
    }),
  );

const shouldDedupeSshUrlWithSshProtocol = () =>
  runTest(
    Effect.sync(() => {
      const sshProtocol = "ssh://git@github.com/user/repo";
      const gitAt = "git:git@github.com:user/repo";

      const sshProtocolIdentity = fixture.packageManager.sources.getPackageIdentity(sshProtocol);
      const gitAtIdentity = fixture.packageManager.sources.getPackageIdentity(gitAt);

      expect(sshProtocolIdentity).toBe("git:github.com/user/repo");
      expect(gitAtIdentity).toBe("git:github.com/user/repo");
      expect(sshProtocolIdentity).toBe(gitAtIdentity);
    }),
  );

const shouldDedupeAllSupportedUrlFormatsFor = () =>
  runTest(
    Effect.sync(() => {
      const urls = [
        "https://github.com/user/repo",
        "https://github.com/user/repo.git",
        "ssh://git@github.com/user/repo",
        "git:https://github.com/user/repo",
        "git:github.com/user/repo",
        "git:git@github.com:user/repo",
        "git:git@github.com:user/repo.git",
      ];

      const identities = urls.map((url) => fixture.packageManager.sources.getPackageIdentity(url));

      const uniqueIdentities = [...new Set(identities)];
      expect(uniqueIdentities.length).toBe(1);
      expect(uniqueIdentities[0]).toBe("git:github.com/user/repo");
    }),
  );

const shouldKeepDifferentReposSeparateHttpsVs = () =>
  runTest(
    Effect.sync(() => {
      const repo1Https = "https://github.com/user/repo1";
      const repo2Ssh = "git:git@github.com:user/repo2";

      const id1 = fixture.packageManager.sources.getPackageIdentity(repo1Https);
      const id2 = fixture.packageManager.sources.getPackageIdentity(repo2Ssh);

      expect(id1).toBe("git:github.com/user/repo1");
      expect(id2).toBe("git:github.com/user/repo2");
      expect(id1).not.toBe(id2);
    }),
  );

describe("DefaultPackageManager", () => {
  describe("package deduplication", () => {
    it(
      "should dedupe same local package in global and project (project wins)",
      shouldDedupeSameLocalPackageInGlobal,
    );

    it("should keep both if different packages", shouldKeepBothIfDifferentPackages);

    it("should dedupe SSH and HTTPS URLs for same repo", shouldDedupeSshAndHttpsUrlsFor);

    it("should dedupe SSH and HTTPS with refs", shouldDedupeSshAndHttpsWithRefs);

    it(
      "should dedupe SSH URL with ssh:// protocol and git@ format",
      shouldDedupeSshUrlWithSshProtocol,
    );

    it(
      "should dedupe all supported URL formats for same repo",
      shouldDedupeAllSupportedUrlFormatsFor,
    );

    it(
      "should keep different repos separate (HTTPS vs SSH)",
      shouldKeepDifferentReposSeparateHttpsVs,
    );
  });
});
