import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { nodeFs, packagePaths, type PackageManagerInternals } from "./package-manager-support.ts";
import { Effect } from "effect";
import { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, toJsonText, writeTextFile } from "@msa/testing";
import { readEnv } from "../src/core/process-env.ts";

describe("DefaultPackageManager", () => {
  let tempDir: string;

  let agentDir: string;

  let settingsManager: SettingsManager;

  let packageManager: DefaultPackageManager;

  let previousOfflineEnv: string | undefined;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        previousOfflineEnv = readEnv("MSA_OFFLINE");
        vi.stubEnv("MSA_OFFLINE", undefined);
        tempDir = yield* makeTempDir("pm-test-");
        agentDir = joinPath(tempDir, "agent");
        yield* makeDirectory(agentDir);

        settingsManager = SettingsManager.inMemory();
        packageManager = new DefaultPackageManager({
          cwd: tempDir,
          agentDir,
          settingsManager,
        });
      }),
    ),
  );

  afterEach(() => {
    vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    return runTest(removePath(tempDir));
  });

  describe("offline mode and network timeouts", () => {
    it("should skip installing missing package sources when offline", () => runTest(
Effect.gen(function* () {

      vi.stubEnv("MSA_OFFLINE", "1");
      settingsManager.setProjectPackages([
        "npm:missing-package",
        "git:github.com/example/missing-repo",
      ]);

      const installParsedSourceSpy = vi.spyOn(packageManager as any, "installParsedSource");

      const result = (yield* awaited(packageManager.resolve()));
      const allResources = [
        ...result.extensions,
        ...result.skills,
        ...result.prompts,
        ...result.themes,
      ];
      expect(allResources.some((r) => r.metadata.origin === "package")).toBe(false);
      expect(installParsedSourceSpy).not.toHaveBeenCalled();
    
}),
));

    it("should skip refreshing temporary git sources when offline", () => runTest(
Effect.gen(function* () {

      vi.stubEnv("MSA_OFFLINE", "1");
      const gitSource = "git:github.com/example/repo";
      const parsedGitSource = (packageManager as any).parseSource(gitSource);
      const installedPath = (packageManager as any).getGitInstallPath(
        parsedGitSource,
        "temporary",
      ) as string;

      (yield* makeDirectory(joinPath(installedPath, "extensions")));
      (yield* writeTextFile(joinPath(installedPath, "extensions", "index.ts"), "export default function() {};"));

      const refreshTemporaryGitSourceSpy = vi.spyOn(
        packageManager as any,
        "refreshTemporaryGitSource",
      );

      const result = (yield* awaited(packageManager.resolveExtensionSources([gitSource], { temporary: true })));
      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "extensions/index.ts") && r.enabled),
      ).toBe(true);
      expect(refreshTemporaryGitSourceSpy).not.toHaveBeenCalled();
    
}),
));

    it("should load a new checkout when a pinned temporary git source changes ref", () => runTest(
Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const managerWithInternals = packageManager as unknown as PackageManagerInternals;
      const oldSource = "git:github.com/example/repo@aaaaaaa";
      const newSource = "git:github.com/example/repo@bbbbbbb";
      const oldParsed = managerWithInternals.parseSource(oldSource);
      const newParsed = managerWithInternals.parseSource(newSource);
      if (oldParsed.type !== "git" || newParsed.type !== "git") {
        throw new Error("Expected git sources");
      }

      const oldPath = managerWithInternals.getGitInstallPath(oldParsed, "temporary");
      (yield* makeDirectory(joinPath(oldPath, "extensions")));
      (yield* writeTextFile(joinPath(oldPath, "extensions", "old.ts"), "export default function() {};"));

      const installParsedSourceSpy = vi
        .spyOn(packageManager as any, "installParsedSource")
        .mockImplementation(() => effectRunPromise(
Effect.sync(() => {

          const newPath = managerWithInternals.getGitInstallPath(newParsed, "temporary");
          nodeFs.mkdirSync(joinPath(newPath, "extensions"), { recursive: true });
          nodeFs.writeFileSync(joinPath(newPath, "extensions", "new.ts"), "export default function() {};");
        
}),
));

      const result = (yield* awaited(packageManager.resolveExtensionSources([newSource], { temporary: true })));
      expect(installParsedSourceSpy).toHaveBeenCalledTimes(1);
      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "extensions/new.ts") && r.enabled),
      ).toBe(true);
      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "extensions/old.ts"))).toBe(false);
    
}),
));

    it("should not run npm view during resolve for installed unpinned packages", () => runTest(
Effect.gen(function* () {

      vi.stubEnv("MSA_OFFLINE", "1");
      const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
      (yield* makeDirectory(joinPath(installedPath, "extensions")));
      (yield* writeTextFile(joinPath(installedPath, "package.json"), (yield* toJsonText({ name: "example", version: "1.0.0" }))));
      (yield* writeTextFile(joinPath(installedPath, "extensions", "index.ts"), "export default function() {};"));
      settingsManager.setProjectPackages(["npm:example@^1.0.0"]);

      const runCommandCaptureSpy = vi.spyOn(packageManager as any, "runCommandCapture");

      const result = (yield* awaited(packageManager.resolve()));
      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "extensions/index.ts") && r.enabled),
      ).toBe(true);
      expect(runCommandCaptureSpy).not.toHaveBeenCalled();
    
}),
));

    it("should reinstall pinned npm packages when installed version does not match", () => runTest(
Effect.gen(function* () {

      const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
      (yield* makeDirectory(installedPath));
      (yield* writeTextFile(joinPath(installedPath, "package.json"), (yield* toJsonText({ name: "example", version: "1.0.0" }))));
      settingsManager.setProjectPackages(["npm:example@2.0.0"]);

      const installParsedSourceSpy = vi
        .spyOn(packageManager as any, "installParsedSource")
        .mockResolvedValue(undefined);

      (yield* awaited(packageManager.resolve()));
      expect(installParsedSourceSpy).toHaveBeenCalledTimes(1);
    
}),
));

    it("should not check package updates when offline", () => runTest(
Effect.gen(function* () {

      vi.stubEnv("MSA_OFFLINE", "1");
      const runCommandCaptureSpy = vi.spyOn(packageManager as any, "runCommandCapture");

      const updates = (yield* awaited(packageManager.checkForAvailableUpdates()));
      expect(updates).toEqual([]);
      expect(runCommandCaptureSpy).not.toHaveBeenCalled();
    
}),
));

    it("should report updates for installed unpinned npm packages", () => runTest(
Effect.gen(function* () {

      const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
      (yield* makeDirectory(installedPath));
      (yield* writeTextFile(joinPath(installedPath, "package.json"), (yield* toJsonText({ name: "example", version: "1.0.0" }))));
      settingsManager.setProjectPackages(["npm:example"]);

      vi.spyOn(packageManager as any, "runCommandCapture").mockResolvedValue('"1.2.3"');

      const updates = (yield* awaited(packageManager.checkForAvailableUpdates()));
      expect(updates).toEqual([
        {
          source: "npm:example",
          displayName: "example",
          type: "npm",
          scope: "project",
        },
      ]);
    
}),
));

    it("should not report npm updates when the installed version is newer than the registry version", () => runTest(
Effect.gen(function* () {

      const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
      (yield* makeDirectory(installedPath));
      (yield* writeTextFile(joinPath(installedPath, "package.json"), (yield* toJsonText({ name: "example", version: "2.0.0" }))));
      settingsManager.setProjectPackages(["npm:example"]);

      vi.spyOn(packageManager as any, "runCommandCapture").mockResolvedValue('"1.9.0"');

      const updates = (yield* awaited(packageManager.checkForAvailableUpdates()));
      expect(updates).toEqual([]);
    
}),
));

    it("should skip pinned packages when checking for updates", () => runTest(
Effect.gen(function* () {

      const installedNpmPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
      (yield* makeDirectory(installedNpmPath));
      (yield* writeTextFile(joinPath(installedNpmPath, "package.json"), (yield* toJsonText({ name: "example", version: "1.0.0" }))));
      const parsedGitSource = (packageManager as any).parseSource("git:github.com/example/repo@v1");
      const installedGitPath = (packageManager as any).getGitInstallPath(
        parsedGitSource,
        "project",
      ) as string;
      (yield* makeDirectory(installedGitPath));

      settingsManager.setProjectPackages(["npm:example@1.0.0", "git:github.com/example/repo@v1"]);

      const runCommandCaptureSpy = vi.spyOn(packageManager as any, "runCommandCapture");
      const gitUpdateSpy = vi.spyOn(packageManager as any, "gitHasAvailableUpdate");

      const updates = (yield* awaited(packageManager.checkForAvailableUpdates()));
      expect(updates).toEqual([]);
      expect(runCommandCaptureSpy).not.toHaveBeenCalled();
      expect(gitUpdateSpy).not.toHaveBeenCalled();
    
}),
));
  });
});
