import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import processEnv from "../src/core/process-env.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import parsedSource from "./parsed-source.ts";

const { asGit } = parsedSource;
const { readEnv } = processEnv;

const { joinPath, makeDirectory, makeTempDir, removePath, runTest } = testing;

let tempDir: string;

let agentDir: string;

let settingsManager: settingsManagerTypes.SettingsManager;

let packageManager: packageManagerTypes.DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldParseHttpsGithubUrlsCorrectly = () =>
  runTest(
    Effect.sync(() => {
      const parsed = asGit(packageManager.sources.parseSource("https://github.com/user/repo"));
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
      expect(parsed.pinned).toBe(false);
    }),
  );

const shouldParseHttpsUrlsWithGitPrefix = () =>
  runTest(
    Effect.sync(() => {
      const parsed = asGit(packageManager.sources.parseSource("git:https://github.com/user/repo"));
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldParseHttpsUrlsWithRef = () =>
  runTest(
    Effect.sync(() => {
      const parsed = asGit(
        packageManager.sources.parseSource("https://github.com/user/repo@v1.2.3"),
      );
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
      const parsed = asGit(packageManager.sources.parseSource("git:github.com/user/repo"));
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldTreatHostPathShorthandAsLocal = () =>
  runTest(
    Effect.sync(() => {
      const parsed = packageManager.sources.parseSource("github.com/user/repo");
      expect(parsed.type).toBe("local");
    }),
  );

const shouldParseHttpsUrlsWithGitSuffix = () =>
  runTest(
    Effect.sync(() => {
      const parsed = asGit(packageManager.sources.parseSource("https://github.com/user/repo.git"));
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldParseGitlabHttpsUrls = () =>
  runTest(
    Effect.sync(() => {
      const parsed = asGit(packageManager.sources.parseSource("https://gitlab.com/user/repo"));
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("gitlab.com");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldParseBitbucketHttpsUrls = () =>
  runTest(
    Effect.sync(() => {
      const parsed = asGit(packageManager.sources.parseSource("https://bitbucket.org/user/repo"));
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("bitbucket.org");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldParseCodebergHttpsUrls = () =>
  runTest(
    Effect.sync(() => {
      const parsed = asGit(packageManager.sources.parseSource("https://codeberg.org/user/repo"));
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("codeberg.org");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldGenerateCorrectPackageIdentityForProtocol = () =>
  runTest(
    Effect.sync(() => {
      const identity1 = packageManager.sources.getPackageIdentity("https://github.com/user/repo");
      const identity2 = packageManager.sources.getPackageIdentity(
        "https://github.com/user/repo@v1.0.0",
      );
      const identity3 = packageManager.sources.getPackageIdentity("git:github.com/user/repo");
      const identity4 = packageManager.sources.getPackageIdentity(
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
