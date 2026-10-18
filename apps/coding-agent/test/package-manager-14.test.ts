import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { packagePaths } from "./package-manager-support.ts";
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

  describe("multi-file extension discovery (issue #1102)", () => {
    it("should only load index.ts from subdirectories, not helper modules", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "multifile-pkg");
      (yield* makeDirectory(joinPath(pkgDir, "extensions", "subagent")));

      (yield* writeTextFile(joinPath(pkgDir, "extensions", "subagent", "index.ts"), `import { helper } from "./agents.ts";
export default function(api) { api.registerTool({ name: "test", description: "test", execute: async () => helper() }); }`));

      (yield* writeTextFile(joinPath(pkgDir, "extensions", "subagent", "agents.ts"), `export function helper() { return "helper"; }`));

      (yield* writeTextFile(joinPath(pkgDir, "extensions", "standalone.ts"), "export default function(api) {}"));

      const result = (yield* awaited(packageManager.resolveExtensionSources([pkgDir])));

      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "subagent/index.ts") && r.enabled),
      ).toBe(true);
      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "standalone.ts") && r.enabled),
      ).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "agents.ts"))).toBe(false);
    
}),
));

    it("should respect package.json msa.extensions manifest in subdirectories", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "manifest-subdir-pkg");
      (yield* makeDirectory(joinPath(pkgDir, "extensions", "custom")));

      (yield* writeTextFile(joinPath(pkgDir, "extensions", "custom", "package.json"), (yield* toJsonText({
          msa: {
            extensions: ["./main.ts"],
          },
        }))));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "custom", "main.ts"), "export default function(api) {}"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "custom", "utils.ts"), "export const util = 1;"));

      const result = (yield* awaited(packageManager.resolveExtensionSources([pkgDir])));

      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "custom/main.ts") && r.enabled),
      ).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "utils.ts"))).toBe(false);
    
}),
));

    it("should handle mixed top-level files and subdirectories", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "mixed-pkg");
      (yield* makeDirectory(joinPath(pkgDir, "extensions", "complex")));

      (yield* writeTextFile(joinPath(pkgDir, "extensions", "simple.ts"), "export default function(api) {}"));

      (yield* writeTextFile(joinPath(pkgDir, "extensions", "complex", "index.ts"), "import { a } from './a.ts'; export default function(api) {}"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "complex", "a.ts"), "export const a = 1;"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "complex", "b.ts"), "export const b = 2;"));

      const result = (yield* awaited(packageManager.resolveExtensionSources([pkgDir])));

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "simple.ts") && r.enabled)).toBe(
        true,
      );
      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "complex/index.ts") && r.enabled),
      ).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "complex/a.ts"))).toBe(false);
      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "complex/b.ts"))).toBe(false);

      expect(result.extensions.filter((r) => r.enabled).length).toBe(2);
    
}),
));

    it("should skip subdirectories without index.ts or manifest", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "no-entry-pkg");
      (yield* makeDirectory(joinPath(pkgDir, "extensions", "broken")));

      (yield* writeTextFile(joinPath(pkgDir, "extensions", "broken", "helper.ts"), "export const x = 1;"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "broken", "another.ts"), "export const y = 2;"));

      (yield* writeTextFile(joinPath(pkgDir, "extensions", "valid.ts"), "export default function(api) {}"));

      const result = (yield* awaited(packageManager.resolveExtensionSources([pkgDir])));

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "valid.ts") && r.enabled)).toBe(
        true,
      );
      expect(result.extensions.filter((r) => r.enabled).length).toBe(1);
    
}),
));
  });

  describe("offline mode and network timeouts", () => {
    it("should update npm range packages using the configured spec", () => runTest(
Effect.gen(function* () {

      const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
      (yield* makeDirectory(installedPath));
      (yield* writeTextFile(joinPath(installedPath, "package.json"), (yield* toJsonText({ name: "example", version: "1.0.0" }))));
      settingsManager.setProjectPackages(["npm:example@^1.0.0"]);

      const runCommandCaptureSpy = vi
        .spyOn(packageManager as any, "runCommandCapture")
        .mockResolvedValue('["1.0.0","1.2.0"]');
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      (yield* awaited(packageManager.update("npm:example")));

      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example@^1.0.0", "version", "--json"],
        expect.objectContaining({ cwd: tempDir, timeoutMs: expect.any(Number) }),
      );
      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        [
          "install",
          "example@^1.0.0",
          "--prefix",
          joinPath(tempDir, ".msa", "npm"),
          "--legacy-peer-deps",
        ],
        undefined,
      );
    
}),
));

    it("should skip project npm update when installed version matches latest", () => runTest(
Effect.gen(function* () {

      const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
      (yield* makeDirectory(installedPath));
      (yield* writeTextFile(joinPath(installedPath, "package.json"), (yield* toJsonText({ name: "example", version: "1.3.1" }))));
      settingsManager.setProjectPackages(["npm:example@^1.0.0"]);

      const runCommandCaptureSpy = vi
        .spyOn(packageManager as any, "runCommandCapture")
        .mockResolvedValue('["1.0.0","1.3.1","1.0.2"]');
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      (yield* awaited(packageManager.update("npm:example")));

      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example@^1.0.0", "version", "--json"],
        expect.objectContaining({ cwd: tempDir, timeoutMs: expect.any(Number) }),
      );
      expect(runCommandSpy).not.toHaveBeenCalled();
    
}),
));

    it("should skip npm updates when the installed version is newer than the registry version", () => runTest(
Effect.gen(function* () {

      const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
      (yield* makeDirectory(installedPath));
      (yield* writeTextFile(joinPath(installedPath, "package.json"), (yield* toJsonText({ name: "example", version: "2.0.0" }))));
      settingsManager.setProjectPackages(["npm:example"]);

      const runCommandCaptureSpy = vi
        .spyOn(packageManager as any, "runCommandCapture")
        .mockResolvedValue('"1.9.0"');
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      (yield* awaited(packageManager.update("npm:example")));

      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example", "version", "--json"],
        expect.objectContaining({ cwd: tempDir, timeoutMs: expect.any(Number) }),
      );
      expect(runCommandSpy).not.toHaveBeenCalled();
    
}),
));
  });
});
