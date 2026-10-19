import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager, type ProgressEvent } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { nodeFs, packagePaths, writeJsonFileSync } from "./package-manager-support.ts";
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

  describe("resolveExtensionSources", () => {
    it("should keep msa manifest entries with leading tilde package-relative", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "tilde-manifest-package");
      const directExtensionPath = joinPath(pkgDir, "~extensions", "main.ts");
      const slashExtensionPath = joinPath(pkgDir, "~", "extensions", "alt.ts");
      const directSkillPath = joinPath(pkgDir, "~skills", "direct-skill", "SKILL.md");
      const slashSkillPath = joinPath(pkgDir, "~", "skills", "slash-skill", "SKILL.md");

      (yield* makeDirectory(joinPath(pkgDir, "~extensions")));
      (yield* makeDirectory(joinPath(pkgDir, "~", "extensions")));
      (yield* makeDirectory(joinPath(pkgDir, "~skills", "direct-skill")));
      (yield* makeDirectory(joinPath(pkgDir, "~", "skills", "slash-skill")));
      (yield* writeTextFile(directExtensionPath, "export default function() {}"));
      (yield* writeTextFile(slashExtensionPath, "export default function() {}"));
      (yield* writeTextFile(directSkillPath, "---\nname: direct-skill\ndescription: Direct\n---\nContent"));
      (yield* writeTextFile(slashSkillPath, "---\nname: slash-skill\ndescription: Slash\n---\nContent"));
      (yield* writeTextFile(joinPath(pkgDir, "package.json"), (yield* toJsonText({
          name: "tilde-manifest-package",
          msa: {
            extensions: ["~extensions/main.ts", "~/extensions/alt.ts"],
            skills: ["~skills", "~/skills"],
          },
        }))));

      const result = (yield* awaited(packageManager.resolveExtensionSources([pkgDir])));

      expect(result.extensions.some((r) => r.path === directExtensionPath && r.enabled)).toBe(true);
      expect(result.extensions.some((r) => r.path === slashExtensionPath && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === directSkillPath && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === slashSkillPath && r.enabled)).toBe(true);
    
}),
));

    it("should handle directories with auto-discovery layout", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "auto-pkg");
      (yield* makeDirectory(joinPath(pkgDir, "extensions")));
      (yield* makeDirectory(joinPath(pkgDir, "themes")));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "main.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(pkgDir, "themes", "dark.json"), "{}"));

      const result = (yield* awaited(packageManager.resolveExtensionSources([pkgDir])));
      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "main.ts") && r.enabled)).toBe(
        true,
      );
      expect(result.themes.some((r) => packagePaths.pathEndsWith(r.path, "dark.json") && r.enabled)).toBe(true);
    
}),
));

    it("should stop recursing when a package skill directory contains SKILL.md", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "skill-root-pkg");
      (yield* makeDirectory(joinPath(pkgDir, "skills", "root-skill", "nested-skill")));
      const rootSkill = joinPath(pkgDir, "skills", "root-skill", "SKILL.md");
      const nestedSkill = joinPath(pkgDir, "skills", "root-skill", "nested-skill", "SKILL.md");
      (yield* writeTextFile(rootSkill, "---\nname: root-skill\ndescription: Root skill\n---\n"));
      (yield* writeTextFile(nestedSkill, "---\nname: nested-skill\ndescription: Nested skill\n---\n"));

      const result = (yield* awaited(packageManager.resolveExtensionSources([pkgDir])));
      expect(result.skills.some((r) => r.path === rootSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === nestedSkill)).toBe(false);
    
}),
));
  });

  describe("progress callback", () => {
    it("should emit progress events", () => runTest(
Effect.gen(function* () {

      const events: ProgressEvent[] = [];
      packageManager.setProgressCallback((event) => events.push(event));

      const extPath = joinPath(tempDir, "ext.ts");
      (yield* writeTextFile(extPath, "export default function() {}"));

      (yield* awaited(packageManager.resolveExtensionSources([extPath])));

      expect(events.length).toBe(0);
    
}),
));
  });

  describe("command spawning", () => {
    it("should preserve argv entries containing spaces", () => {
      const managerWithInternals = packageManager as unknown as {
        runCommandSync(command: string, args: string[]): string;
      };
      const valueWithSpace = "C:\\Users\\A B\\.msa\\npm";
      const output = managerWithInternals.runCommandSync(process.execPath, [
        "-e",
        "console.log(process.argv[1])",
        valueWithSpace,
      ]);

      expect(output).toBe(valueWithSpace);
    });
  });

  describe("npmCommand", () => {
    it("should use npmCommand argv for npm installs", () => runTest(
Effect.gen(function* () {

      settingsManager = SettingsManager.inMemory({
        npmCommand: ["mise", "exec", "node@20", "--", "npm"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      (yield* awaited(packageManager.install("npm:@scope/pkg")));

      expect(runCommandSpy).toHaveBeenCalledWith(
        "mise",
        [
          "exec",
          "node@20",
          "--",
          "npm",
          "install",
          "@scope/pkg",
          "--prefix",
          joinPath(agentDir, "npm"),
          "--legacy-peer-deps",
        ],
        undefined,
      );
    
}),
));

    it("should pass legacy peer deps when uninstalling npm packages", () => runTest(
Effect.gen(function* () {

      (yield* makeDirectory(joinPath(agentDir, "npm")));
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      (yield* awaited(packageManager.remove("npm:@scope/pkg")));

      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        ["uninstall", "@scope/pkg", "--prefix", joinPath(agentDir, "npm"), "--legacy-peer-deps"],
        undefined,
      );
    
}),
));

    it("should use bun --cwd for npm package installs", () => runTest(
Effect.gen(function* () {

      settingsManager = SettingsManager.inMemory({
        npmCommand: ["mise", "exec", "bun@1", "--", "bun"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      (yield* awaited(packageManager.install("npm:@scope/pkg")));

      expect(runCommandSpy).toHaveBeenCalledWith(
        "mise",
        [
          "exec",
          "bun@1",
          "--",
          "bun",
          "install",
          "@scope/pkg",
          "--cwd",
          joinPath(agentDir, "npm"),
          "--omit=peer",
        ],
        undefined,
      );
    
}),
));

    it("should install git package dependencies without auto-installing peers", () => runTest(
Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const source = "git:github.com/user/repo";
      const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockImplementation((...callArgs: unknown[]) => effectRunPromise(
Effect.sync(() => {

          const [command, args] = callArgs as [string, string[]];
          if (command === "git" && args[0] === "clone") {
            nodeFs.mkdirSync(targetDir, { recursive: true });
            writeJsonFileSync({
              file: joinPath(targetDir, "package.json"),
              value: { name: "repo", version: "1.0.0" },
            });
          }
        
}),
));

      (yield* awaited(packageManager.install(source)));

      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        ["install", "--omit=dev", "--legacy-peer-deps"],
        {
          cwd: targetDir,
        },
      );
    
}),
));
  });
});
