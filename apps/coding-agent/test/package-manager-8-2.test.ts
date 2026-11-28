import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import type packageManagerTypes from "../src/core/package-manager.types.ts";
import commandRunner from "../src/core/package-manager/command-runner.ts";
import packageManagerFixture from "./package-manager-fixture.ts";
import parsedSource from "./parsed-source.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { asLocal } = parsedSource;

const { awaited, runTest } = testing;

const shouldEmitProgressEventsOnInstallAttempt = () =>
  runTest(
    Effect.gen(function* () {
      const events: packageManagerTypes.ProgressEvent[] = [];
      fixture.packageManager.progress.setProgressCallback((event) => events.push(event));
      vi.spyOn(commandRunner, "runCommand").mockRejectedValue(
        new Error("simulated npm install failure"),
      );

      yield* awaited(
        expect(
          fixture.packageManager.operations.install.install("npm:nonexistent-package@1.0.0"),
        ).rejects.toThrow("simulated npm install failure"),
      );

      expect(events.some((e) => e.type === "start" && e.action === "install")).toBe(true);
      expect(events.some((e) => e.type === "error")).toBe(true);
    }),
  );

const shouldRecognizeGithubUrlsWithoutGitPrefix = () =>
  runTest(
    Effect.gen(function* () {
      const events: packageManagerTypes.ProgressEvent[] = [];
      fixture.packageManager.progress.setProgressCallback((event) => events.push(event));
      const runCommand = vi
        .spyOn(commandRunner, "runCommand")
        .mockRejectedValue(new Error("simulated git clone failure"));
      const source = "https://github.com/nonexistent/repo";

      yield* awaited(
        expect(fixture.packageManager.operations.install.install(source)).rejects.toThrow(
          "simulated git clone failure",
        ),
      );

      expect(runCommand).toHaveBeenCalledWith("git", ["clone", source, expect.any(String)]);
      expect(events.some((e) => e.type === "start" && e.action === "install")).toBe(true);
    }),
  );

const shouldParsePackageSourceTypesFromDocs = () => {
  const parseNpm = (source: string) => {
    const parsed = fixture.packageManager.sources.parseSource(source);
    if (parsed.type !== "npm") {
      throw new Error(`Expected npm source: ${source}`);
    }
    return parsed;
  };

  expect(parseNpm("npm:@scope/pkg@1.2.3").pinned).toBe(true);
  expect(parseNpm("npm:@scope/pkg@^1.2.3").pinned).toBe(false);
  expect(parseNpm("npm:pkg").pinned).toBe(false);

  expect(fixture.packageManager.sources.parseSource("git:github.com/user/repo@v1").type).toBe(
    "git",
  );
  expect(fixture.packageManager.sources.parseSource("https://github.com/user/repo@v1").type).toBe(
    "git",
  );
  expect(fixture.packageManager.sources.parseSource("git:git@github.com:user/repo@v1").type).toBe(
    "git",
  );
  expect(fixture.packageManager.sources.parseSource("ssh://git@github.com/user/repo@v1").type).toBe(
    "git",
  );

  expect(fixture.packageManager.sources.parseSource("/absolute/path/to/package").type).toBe(
    "local",
  );
  expect(fixture.packageManager.sources.parseSource("./relative/path/to/package").type).toBe(
    "local",
  );
  expect(fixture.packageManager.sources.parseSource("../relative/path/to/package").type).toBe(
    "local",
  );
};

const shouldNeverParseDotRelativePathsAs = () => {
  const dotSlash = asLocal(fixture.packageManager.sources.parseSource("./packages/agent-timers"));
  expect(dotSlash.type).toBe("local");
  expect(dotSlash.path).toBe("./packages/agent-timers");

  const dotDotSlash = asLocal(
    fixture.packageManager.sources.parseSource("../packages/agent-timers"),
  );
  expect(dotDotSlash.type).toBe("local");
  expect(dotDotSlash.path).toBe("../packages/agent-timers");
};

const shouldRejectPathsOutsideGitInstallRoots = () => {
  const traversalSource = {
    host: "evil.example",
    path: "../../victim/repo",
    pinned: false,
    repo: "git@evil.example:../../victim/repo",
    type: "git" as const,
  };

  const { paths } = fixture.packageManager.git;
  for (const scope of ["user", "project", "temporary"] as const) {
    expect(() => paths.getGitInstallPath(traversalSource, scope)).toThrow(
      "outside package install root",
    );
  }
};

describe("DefaultPackageManager", () => {
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
  describe("git install paths", () => {
    it("should reject paths outside git install roots", shouldRejectPathsOutsideGitInstallRoots);
  });
});
