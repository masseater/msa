import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { readEnv } from "../src/core/process-env.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const { joinPath, makeDirectory, makeTempDir, removePath, runTest } = testing;

let tempDir: string;

let agentDir: string;

let settingsManager: SettingsManager;

let packageManager: DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldParseHttpsGithubUrlsCorrectly = () =>
  runTest(
    Effect.sync(() => {
      const parsed = (packageManager as any).parseSource("https://github.com/user/repo");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
      expect(parsed.pinned).toBe(false);
    }),
  );

const shouldParseHttpsUrlsWithGitPrefix = () =>
  runTest(
    Effect.sync(() => {
      const parsed = (packageManager as any).parseSource("git:https://github.com/user/repo");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldParseHttpsUrlsWithRef = () =>
  runTest(
    Effect.sync(() => {
      const parsed = (packageManager as any).parseSource("https://github.com/user/repo@v1.2.3");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
      expect(parsed.ref).toBe("v1.2.3");
      expect(parsed.pinned).toBe(true);
    }),
  );

const shouldParseHostPathShorthandOnlyWith = () =>
  runTest(
    Effect.sync(() => {
      const parsed = (packageManager as any).parseSource("git:github.com/user/repo");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldTreatHostPathShorthandAsLocal = () =>
  runTest(
    Effect.sync(() => {
      const parsed = (packageManager as any).parseSource("github.com/user/repo");
      expect(parsed.type).toBe("local");
    }),
  );

const shouldParseHttpsUrlsWithGitSuffix = () =>
  runTest(
    Effect.sync(() => {
      const parsed = (packageManager as any).parseSource("https://github.com/user/repo.git");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldParseGitlabHttpsUrls = () =>
  runTest(
    Effect.sync(() => {
      const parsed = (packageManager as any).parseSource("https://gitlab.com/user/repo");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("gitlab.com");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldParseBitbucketHttpsUrls = () =>
  runTest(
    Effect.sync(() => {
      const parsed = (packageManager as any).parseSource("https://bitbucket.org/user/repo");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("bitbucket.org");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldParseCodebergHttpsUrls = () =>
  runTest(
    Effect.sync(() => {
      const parsed = (packageManager as any).parseSource("https://codeberg.org/user/repo");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("codeberg.org");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldGenerateCorrectPackageIdentityForProtocol = () =>
  runTest(
    Effect.sync(() => {
      const identity1 = (packageManager as any).getPackageIdentity("https://github.com/user/repo");
      const identity2 = (packageManager as any).getPackageIdentity(
        "https://github.com/user/repo@v1.0.0",
      );
      const identity3 = (packageManager as any).getPackageIdentity("git:github.com/user/repo");
      const identity4 = (packageManager as any).getPackageIdentity(
        "https://github.com/user/repo.git",
      );

      expect(identity1).toBe("git:github.com/user/repo");
      expect(identity2).toBe("git:github.com/user/repo");
      expect(identity3).toBe("git:github.com/user/repo");
      expect(identity4).toBe("git:github.com/user/repo");
    }),
  );

const beforeEachHook3 = () =>
  runTest(
    Effect.gen(function* () {
      previousOfflineEnv = readEnv("MSA_OFFLINE");
      vi.stubEnv("MSA_OFFLINE", undefined);
      tempDir = yield* makeTempDir("pm-test-");
      agentDir = joinPath(tempDir, "agent");
      yield* makeDirectory(agentDir);

      settingsManager = SettingsManager.inMemory();
      packageManager = new DefaultPackageManager({
        agentDir,
        cwd: tempDir,
        settingsManager,
      });
    }),
  );

const afterEachHook3 = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook3);

  afterEach(afterEachHook3);

  describe("HTTPS git URL parsing (old behavior)", () => {
    it("should parse HTTPS GitHub URLs correctly", shouldParseHttpsGithubUrlsCorrectly);

    it("should parse HTTPS URLs with git: prefix", shouldParseHttpsUrlsWithGitPrefix);

    it("should parse HTTPS URLs with ref", shouldParseHttpsUrlsWithRef);

    it(
      "should parse host/path shorthand only with git: prefix",
      shouldParseHostPathShorthandOnlyWith,
    );

    it(
      "should treat host/path shorthand as local without git: prefix",
      shouldTreatHostPathShorthandAsLocal,
    );

    it("should parse HTTPS URLs with .git suffix", shouldParseHttpsUrlsWithGitSuffix);

    it("should parse GitLab HTTPS URLs", shouldParseGitlabHttpsUrls);

    it("should parse Bitbucket HTTPS URLs", shouldParseBitbucketHttpsUrls);

    it("should parse Codeberg HTTPS URLs", shouldParseCodebergHttpsUrls);

    it(
      "should generate correct package identity for protocol and git:-prefixed URLs",
      shouldGenerateCorrectPackageIdentityForProtocol,
    );
  });
});
