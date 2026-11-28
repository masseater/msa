import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import gitUpdateSupport from "./git-update-support.ts";
const {
  createCommit,
  getCurrentCommit,
  getFileContent,
  git,
  gitSource,
  initGitRepo,
  useGitUpdateFixture,
} = gitUpdateSupport;

const fx = useGitUpdateFixture();

const { awaited, joinPath, makeDirectory, runTest } = testing;

const shouldCheckoutTheConfiguredPinnedGitRef = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(fx.remoteDir);
      yield* initGitRepo(fx.remoteDir);
      const v1Commit = yield* createCommit(fx.remoteDir, "extension.ts", "// v1", "Initial commit");
      yield* git(["tag", "v1"], fx.remoteDir);
      const v2Commit = yield* createCommit(fx.remoteDir, "extension.ts", "// v2", "Second commit");
      yield* git(["tag", "v2"], fx.remoteDir);

      yield* makeDirectory(joinPath(fx.agentDir, "git", "github.com", "test"));
      yield* git(["clone", fx.remoteDir, fx.installedDir], fx.tempDir);
      yield* git(["checkout", "v1"], fx.installedDir);
      expect(yield* getCurrentCommit(fx.installedDir)).toBe(v1Commit);

      const pinnedSource = `${gitSource}@v2`;
      fx.settingsManager.resources.setPackages([pinnedSource]);

      yield* awaited(fx.packageManager.operations.updates.update());

      expect(yield* getCurrentCommit(fx.installedDir)).toBe(v2Commit);
      expect(yield* getFileContent(fx.installedDir, "extension.ts")).toBe("// v2");

      yield* git(["checkout", "v1"], fx.installedDir);

      yield* awaited(fx.packageManager.operations.updates.update(pinnedSource));

      expect(yield* getCurrentCommit(fx.installedDir)).toBe(v2Commit);
      expect(yield* getFileContent(fx.installedDir, "extension.ts")).toBe("// v2");
    }),
  );

describe("DefaultPackageManager git update", () => {
  describe("pinned sources", () => {
    it(
      "should checkout the configured pinned git ref during full and targeted updates",
      shouldCheckoutTheConfiguredPinnedGitRef,
    );
  });
});
