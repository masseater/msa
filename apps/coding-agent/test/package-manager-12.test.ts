import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { packagePaths, type PackageManagerInternals } from "./package-manager-support.ts";
import { Effect } from "effect";
import { awaited, joinPath, makeDirectory, makeTempDir, relativePath, removePath, runTest, toJsonText, writeTextFile } from "@msa/testing";
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

  describe("pattern filtering in package filters", () => {
    it("should work with direct paths (no patterns)", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "direct-pkg");
      (yield* makeDirectory(joinPath(pkgDir, "extensions")));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "one.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "two.ts"), "export default function() {}"));

      settingsManager.setPackages([
        {
          source: pkgDir,
          extensions: ["extensions/one.ts"],
          skills: [],
          prompts: [],
          themes: [],
        },
      ]);

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "one.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "two.ts"))).toBe(true);
    
}),
));

    it("should resolve autoload-disabled project package entries as deltas over global packages", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(agentDir, "npm", "node_modules", "msa-tools");
      (yield* makeDirectory(joinPath(pkgDir, "extensions")));
      (yield* writeTextFile(joinPath(pkgDir, "package.json"), (yield* toJsonText({ name: "msa-tools", version: "1.0.0" }))));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "foo.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "bar.ts"), "export default function() {}"));
      settingsManager.setPackages(["npm:msa-tools"]);
      settingsManager.setProjectPackages([
        { source: "npm:msa-tools", autoload: false, extensions: ["-extensions/foo.ts"] },
      ]);
      const runCommandSpy = vi
        .spyOn(packageManager as unknown as PackageManagerInternals, "runCommand")
        .mockRejectedValue(new Error("unexpected install"));

      const result = (yield* awaited(packageManager.resolve()));
      const states = Object.fromEntries(
        result.extensions.map((resource) => [
          resource.path,
          { enabled: resource.enabled, scope: resource.metadata.scope },
        ]),
      );
      expect(runCommandSpy).not.toHaveBeenCalled();
      expect(states[joinPath(pkgDir, "extensions", "foo.ts")]).toEqual({
        enabled: false,
        scope: "project",
      });
      expect(states[joinPath(pkgDir, "extensions", "bar.ts")]).toEqual({
        enabled: true,
        scope: "user",
      });
    
}),
));

    it("should resolve autoload-disabled package entries as positive-only without a global package", () => runTest(
Effect.gen(function* () {

      vi.stubEnv("HOME", tempDir);
      const pkgDir = joinPath(tempDir, "positive-only-pkg");
      (yield* makeDirectory(joinPath(pkgDir, "extensions")));
      (yield* makeDirectory(joinPath(pkgDir, "skills", "foo")));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "foo.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "bar.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(pkgDir, "skills", "foo", "SKILL.md"), "# Foo\n"));
      settingsManager.setProjectPackages([
        {
          source: relativePath(joinPath(tempDir, ".msa"), pkgDir),
          autoload: false,
          extensions: ["+extensions/foo.ts"],
        },
      ]);

      const result = (yield* awaited(packageManager.resolve()));

      expect(result.extensions.map((resource) => resource.path)).toEqual([
        joinPath(pkgDir, "extensions", "foo.ts"),
      ]);
      expect(result.skills).toEqual([]);
    
}),
));
  });

  describe("force-include patterns", () => {
    it("should force-include extensions with + pattern after exclusion", () => runTest(
Effect.gen(function* () {

      const extDir = joinPath(agentDir, "extensions");
      (yield* makeDirectory(extDir));
      (yield* writeTextFile(joinPath(extDir, "keep.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(extDir, "excluded.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(extDir, "force-back.ts"), "export default function() {}"));

      settingsManager.setExtensionPaths([
        "extensions",
        "!extensions/*.ts",
        "+extensions/force-back.ts",
      ]);

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "keep.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "excluded.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "force-back.ts"))).toBe(true);
    
}),
));

    it("should force-include overrides exclude in package filters", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "force-pkg");
      (yield* makeDirectory(joinPath(pkgDir, "extensions")));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "alpha.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "beta.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "gamma.ts"), "export default function() {}"));

      settingsManager.setPackages([
        {
          source: pkgDir,
          extensions: ["!**/*.ts", "+extensions/beta.ts"],
          skills: [],
          prompts: [],
          themes: [],
        },
      ]);

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "alpha.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "beta.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "gamma.ts"))).toBe(true);
    
}),
));

    it("should force-include multiple resources", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "multi-force-pkg");
      (yield* makeDirectory(joinPath(pkgDir, "skills/skill-a")));
      (yield* makeDirectory(joinPath(pkgDir, "skills/skill-b")));
      (yield* makeDirectory(joinPath(pkgDir, "skills/skill-c")));
      (yield* writeTextFile(joinPath(pkgDir, "skills/skill-a", "SKILL.md"), "---\nname: skill-a\ndescription: A\n---\nContent"));
      (yield* writeTextFile(joinPath(pkgDir, "skills/skill-b", "SKILL.md"), "---\nname: skill-b\ndescription: B\n---\nContent"));
      (yield* writeTextFile(joinPath(pkgDir, "skills/skill-c", "SKILL.md"), "---\nname: skill-c\ndescription: C\n---\nContent"));

      settingsManager.setPackages([
        {
          source: pkgDir,
          extensions: [],
          skills: ["!**/*", "+skills/skill-a", "+skills/skill-c"],
          prompts: [],
          themes: [],
        },
      ]);

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.skills.some((r) => packagePaths.isEnabled(r, "skill-a", "includes"))).toBe(true);
      expect(result.skills.some((r) => packagePaths.isDisabled(r, "skill-b", "includes"))).toBe(true);
      expect(result.skills.some((r) => packagePaths.isEnabled(r, "skill-c", "includes"))).toBe(true);
    
}),
));

    it("should force-include after specific exclusion", () => runTest(
Effect.gen(function* () {

      const extDir = joinPath(agentDir, "extensions");
      (yield* makeDirectory(extDir));
      (yield* writeTextFile(joinPath(extDir, "a.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(extDir, "b.ts"), "export default function() {}"));

      settingsManager.setExtensionPaths(["extensions", "!extensions/b.ts", "+extensions/b.ts"]);

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "a.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "b.ts"))).toBe(true);
    
}),
));

    it("should handle force-include in manifest patterns", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "manifest-force-pkg");
      (yield* makeDirectory(joinPath(pkgDir, "extensions")));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "one.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "two.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "three.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(pkgDir, "package.json"), (yield* toJsonText({
          name: "manifest-force-pkg",
          msa: {
            extensions: ["extensions", "!**/two.ts", "+extensions/two.ts"],
          },
        }))));

      const result = (yield* awaited(packageManager.resolveExtensionSources([pkgDir])));
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "one.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "two.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "three.ts"))).toBe(true);
    
}),
));
  });
});
