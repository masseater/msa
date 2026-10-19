import { joinPath, makeDirectory, makeTempDir, removeDirs, runTest } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const tempDirs: string[] = [];

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const withPackageManager = <A>(
  use: (packageManager: DefaultPackageManager) => A,
): Effect.Effect<A> =>
  Effect.gen(function* () {
    const tempDir = yield* makeTempDir("pm-ssh-test-");
    tempDirs.push(tempDir);
    const agentDir = joinPath(tempDir, "agent");
    yield* makeDirectory(agentDir);
    const packageManager = new DefaultPackageManager({
      cwd: tempDir,
      agentDir,
      settingsManager: SettingsManager.inMemory(),
    });
    return use(packageManager);
  });

const parseSource = (packageManager: DefaultPackageManager, source: string): unknown =>
  (packageManager as any).parseSource(source);

const identityOf = (packageManager: DefaultPackageManager, source: string): unknown =>
  (packageManager as any).getPackageIdentity(source);

describe("Package Manager git source parsing", () => {
  describe("protocol URLs without git: prefix", () => {
    it("should parse https:// URL", () =>
      runTest(
        withPackageManager((packageManager) => {
          const parsed = parseSource(packageManager, "https://github.com/user/repo") as any;
          expect(parsed.type).toBe("git");
          expect(parsed.host).toBe("github.com");
          expect(parsed.path).toBe("user/repo");
        }),
      ));

    it("should parse ssh:// URL", () =>
      runTest(
        withPackageManager((packageManager) => {
          const parsed = parseSource(packageManager, "ssh://git@github.com/user/repo") as any;
          expect(parsed.type).toBe("git");
          expect(parsed.host).toBe("github.com");
          expect(parsed.path).toBe("user/repo");
          expect(parsed.repo).toBe("ssh://git@github.com/user/repo");
        }),
      ));
  });

  describe("shorthand URLs with git: prefix", () => {
    it("should parse git@host:path format", () =>
      runTest(
        withPackageManager((packageManager) => {
          const parsed = parseSource(packageManager, "git:git@github.com:user/repo") as any;
          expect(parsed.type).toBe("git");
          expect(parsed.host).toBe("github.com");
          expect(parsed.path).toBe("user/repo");
          expect(parsed.repo).toBe("git@github.com:user/repo");
          expect(parsed.pinned).toBe(false);
        }),
      ));

    it("should parse host/path shorthand", () =>
      runTest(
        withPackageManager((packageManager) => {
          const parsed = parseSource(packageManager, "git:github.com/user/repo") as any;
          expect(parsed.type).toBe("git");
          expect(parsed.host).toBe("github.com");
          expect(parsed.path).toBe("user/repo");
        }),
      ));

    it("should parse shorthand with ref", () =>
      runTest(
        withPackageManager((packageManager) => {
          const parsed = parseSource(packageManager, "git:git@github.com:user/repo@v1.0.0") as any;
          expect(parsed.type).toBe("git");
          expect(parsed.ref).toBe("v1.0.0");
          expect(parsed.pinned).toBe(true);
        }),
      ));
  });

  describe("unsupported without git: prefix", () => {
    it("should treat git@host:path as local without git: prefix", () =>
      runTest(
        withPackageManager((packageManager) => {
          const parsed = parseSource(packageManager, "git@github.com:user/repo") as any;
          expect(parsed.type).toBe("local");
        }),
      ));

    it("should treat host/path shorthand as local without git: prefix", () =>
      runTest(
        withPackageManager((packageManager) => {
          const parsed = parseSource(packageManager, "github.com/user/repo") as any;
          expect(parsed.type).toBe("local");
        }),
      ));
  });

  describe("identity normalization", () => {
    it("should normalize protocol and shorthand-prefixed URLs to same identity", () =>
      runTest(
        withPackageManager((packageManager) => {
          const prefixed = identityOf(packageManager, "git:git@github.com:user/repo");
          const https = identityOf(packageManager, "https://github.com/user/repo");
          const ssh = identityOf(packageManager, "ssh://git@github.com/user/repo");

          expect(prefixed).toBe("git:github.com/user/repo");
          expect(prefixed).toBe(https);
          expect(prefixed).toBe(ssh);
        }),
      ));
  });
});
