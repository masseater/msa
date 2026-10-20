import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import SettingsManager from "../src/core/settings-manager.ts";

const { joinPath, makeDirectory, makeTempDir, removeDirs, runTest } = testing;

const tempDirs: string[] = [];

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const withPackageManager = <A>(
  use: (packageManager: packageManagerTypes.DefaultPackageManager) => A,
): Effect.Effect<A> =>
  Effect.gen(function* () {
    const tempDir = yield* makeTempDir("pm-ssh-test-");
    tempDirs.push(tempDir);
    const agentDir = joinPath(tempDir, "agent");
    yield* makeDirectory(agentDir);
    const packageManager = new DefaultPackageManager({
      agentDir,
      cwd: tempDir,
      settingsManager: SettingsManager.inMemory(),
    });
    return use(packageManager);
  });

const parseSource = (
  packageManager: packageManagerTypes.DefaultPackageManager,
  source: string,
): unknown => packageManager.sources.parseSource(source);

const identityOf = (
  packageManager: packageManagerTypes.DefaultPackageManager,
  source: string,
): unknown => packageManager.sources.getPackageIdentity(source);

const shouldParseHttpsUrl = () =>
  runTest(
    withPackageManager((packageManager) => {
      const parsed = parseSource(packageManager, "https://github.com/user/repo") as any;
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldParseSshUrl = () =>
  runTest(
    withPackageManager((packageManager) => {
      const parsed = parseSource(packageManager, "ssh://git@github.com/user/repo") as any;
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
      expect(parsed.repo).toBe("ssh://git@github.com/user/repo");
    }),
  );

const shouldParseGitHostPathFormat = () =>
  runTest(
    withPackageManager((packageManager) => {
      const parsed = parseSource(packageManager, "git:git@github.com:user/repo") as any;
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
      expect(parsed.repo).toBe("git@github.com:user/repo");
      expect(parsed.pinned).toBe(false);
    }),
  );

const shouldParseHostPathShorthand = () =>
  runTest(
    withPackageManager((packageManager) => {
      const parsed = parseSource(packageManager, "git:github.com/user/repo") as any;
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
    }),
  );

const shouldParseShorthandWithRef = () =>
  runTest(
    withPackageManager((packageManager) => {
      const parsed = parseSource(packageManager, "git:git@github.com:user/repo@v1.0.0") as any;
      expect(parsed.type).toBe("git");
      expect(parsed.ref).toBe("v1.0.0");
      expect(parsed.pinned).toBe(true);
    }),
  );

const shouldTreatGitHostPathAsLocal = () =>
  runTest(
    withPackageManager((packageManager) => {
      const parsed = parseSource(packageManager, "git@github.com:user/repo") as any;
      expect(parsed.type).toBe("local");
    }),
  );

const shouldTreatHostPathShorthandAsLocal = () =>
  runTest(
    withPackageManager((packageManager) => {
      const parsed = parseSource(packageManager, "github.com/user/repo") as any;
      expect(parsed.type).toBe("local");
    }),
  );

const shouldNormalizeProtocolAndShorthandPrefixedUrls = () =>
  runTest(
    withPackageManager((packageManager) => {
      const prefixed = identityOf(packageManager, "git:git@github.com:user/repo");
      const https = identityOf(packageManager, "https://github.com/user/repo");
      const ssh = identityOf(packageManager, "ssh://git@github.com/user/repo");

      expect(prefixed).toBe("git:github.com/user/repo");
      expect(prefixed).toBe(https);
      expect(prefixed).toBe(ssh);
    }),
  );

describe("Package Manager git source parsing", () => {
  describe("protocol URLs without git: prefix", () => {
    it("should parse https:// URL", shouldParseHttpsUrl);

    it("should parse ssh:// URL", shouldParseSshUrl);
  });

  describe("shorthand URLs with git: prefix", () => {
    it("should parse git@host:path format", shouldParseGitHostPathFormat);

    it("should parse host/path shorthand", shouldParseHostPathShorthand);

    it("should parse shorthand with ref", shouldParseShorthandWithRef);
  });

  describe("unsupported without git: prefix", () => {
    it("should treat git@host:path as local without git: prefix", shouldTreatGitHostPathAsLocal);

    it(
      "should treat host/path shorthand as local without git: prefix",
      shouldTreatHostPathShorthandAsLocal,
    );
  });

  describe("identity normalization", () => {
    it(
      "should normalize protocol and shorthand-prefixed URLs to same identity",
      shouldNormalizeProtocolAndShorthandPrefixedUrls,
    );
  });
});
