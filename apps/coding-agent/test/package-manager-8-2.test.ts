import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import processEnv from "../src/core/process-env.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import type packageManagerSupportTypes from "./package-manager-support.types.ts";
const { readEnv } = processEnv;

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest } = testing;

let tempDir: string;

let agentDir: string;

let settingsManager: settingsManagerTypes.SettingsManager;

let packageManager: packageManagerTypes.DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldEmitProgressEventsOnInstallAttempt = () =>
  runTest(
    Effect.gen(function* () {
      const events: packageManagerTypes.ProgressEvent[] = [];
      packageManager.setProgressCallback((event) => events.push(event));
      vi.spyOn(
        packageManager as unknown as packageManagerSupportTypes.PackageManagerInternals,
        "runCommand",
      ).mockRejectedValue(new Error("simulated npm install failure"));

      yield* awaited(
        expect(packageManager.install("npm:nonexistent-package@1.0.0")).rejects.toThrow(
          "simulated npm install failure",
        ),
      );

      expect(events.some((e) => e.type === "start" && e.action === "install")).toBe(true);
      expect(events.some((e) => e.type === "error")).toBe(true);
    }),
  );

const shouldRecognizeGithubUrlsWithoutGitPrefix = () =>
  runTest(
    Effect.gen(function* () {
      const events: packageManagerTypes.ProgressEvent[] = [];
      packageManager.setProgressCallback((event) => events.push(event));
      const runCommand = vi
        .spyOn(
          packageManager as unknown as packageManagerSupportTypes.PackageManagerInternals,
          "runCommand",
        )
        .mockRejectedValue(new Error("simulated git clone failure"));
      const source = "https://github.com/nonexistent/repo";

      yield* awaited(
        expect(packageManager.install(source)).rejects.toThrow("simulated git clone failure"),
      );

      expect(runCommand).toHaveBeenCalledWith("git", ["clone", source, expect.any(String)]);
      expect(events.some((e) => e.type === "start" && e.action === "install")).toBe(true);
    }),
  );

const shouldParsePackageSourceTypesFromDocs = () => {
  const parseNpm = (source: string) => {
    const parsed = (packageManager as any).parseSource(source);
    if (parsed.type !== "npm") {
      throw new Error(`Expected npm source: ${source}`);
    }
    return parsed;
  };

  expect(parseNpm("npm:@scope/pkg@1.2.3").pinned).toBe(true);
  expect(parseNpm("npm:@scope/pkg@^1.2.3").pinned).toBe(false);
  expect(parseNpm("npm:pkg").pinned).toBe(false);

  expect((packageManager as any).parseSource("git:github.com/user/repo@v1").type).toBe("git");
  expect((packageManager as any).parseSource("https://github.com/user/repo@v1").type).toBe("git");
  expect((packageManager as any).parseSource("git:git@github.com:user/repo@v1").type).toBe("git");
  expect((packageManager as any).parseSource("ssh://git@github.com/user/repo@v1").type).toBe("git");

  expect((packageManager as any).parseSource("/absolute/path/to/package").type).toBe("local");
  expect((packageManager as any).parseSource("./relative/path/to/package").type).toBe("local");
  expect((packageManager as any).parseSource("../relative/path/to/package").type).toBe("local");
};

const shouldNeverParseDotRelativePathsAs = () => {
  const dotSlash = (packageManager as any).parseSource("./packages/agent-timers");
  expect(dotSlash.type).toBe("local");
  expect(dotSlash.path).toBe("./packages/agent-timers");

  const dotDotSlash = (packageManager as any).parseSource("../packages/agent-timers");
  expect(dotDotSlash.type).toBe("local");
  expect(dotDotSlash.path).toBe("../packages/agent-timers");
};

const shouldRejectPathsOutsideGitInstallRoots = () => {
  const managerWithInternals =
    packageManager as unknown as packageManagerSupportTypes.PackageManagerInternals;
  const traversalSource = {
    host: "evil.example",
    path: "../../victim/repo",
    pinned: false,
    repo: "git@evil.example:../../victim/repo",
    type: "git" as const,
  };

  for (const scope of ["user", "project", "temporary"] as const) {
    expect(() => managerWithInternals.getGitInstallPath(traversalSource, scope)).toThrow(
      "outside package install root",
    );
  }
};

const beforeEachHook2 = () =>
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

const afterEachHook2 = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook2);

  afterEach(afterEachHook2);

  describe("source parsing", () => {
    it("should emit progress events on install attempt", shouldEmitProgressEventsOnInstallAttempt);

    it(
      "should recognize github URLs without git: prefix",
      shouldRecognizeGithubUrlsWithoutGitPrefix,
    );

    it(
      "should parse package source types from docs examples",
      shouldParsePackageSourceTypesFromDocs,
    );

    it("should never parse dot-relative paths as git", shouldNeverParseDotRelativePathsAs);
  });
});

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook2);

  afterEach(afterEachHook2);

  describe("git install paths", () => {
    it("should reject paths outside git install roots", shouldRejectPathsOutsideGitInstallRoots);
  });
});
