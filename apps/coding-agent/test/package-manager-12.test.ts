import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { type PackageManagerInternals, isEnabled, isDisabled } from "./package-manager-support.ts";

describe("DefaultPackageManager", () => {
  let tempDir: string;

  let agentDir: string;

  let settingsManager: SettingsManager;

  let packageManager: DefaultPackageManager;

  let previousOfflineEnv: string | undefined;

  beforeEach(() => {
    previousOfflineEnv = process.env["MSA_OFFLINE"];
    delete process.env["MSA_OFFLINE"];
    tempDir = join(tmpdir(), `pm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    agentDir = join(tempDir, "agent");
    mkdirSync(agentDir, { recursive: true });

    settingsManager = SettingsManager.inMemory();
    packageManager = new DefaultPackageManager({
      cwd: tempDir,
      agentDir,
      settingsManager,
    });
  });

  afterEach(() => {
    if (previousOfflineEnv === undefined) {
      delete process.env["MSA_OFFLINE"];
    } else {
      process.env["MSA_OFFLINE"] = previousOfflineEnv;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("pattern filtering in package filters", () => {
    it("should work with direct paths (no patterns)", async () => {
      const pkgDir = join(tempDir, "direct-pkg");
      mkdirSync(join(pkgDir, "extensions"), { recursive: true });
      writeFileSync(join(pkgDir, "extensions", "one.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "two.ts"), "export default function() {}");

      settingsManager.setPackages([
        {
          source: pkgDir,
          extensions: ["extensions/one.ts"],
          skills: [],
          prompts: [],
          themes: [],
        },
      ]);

      const result = await packageManager.resolve();
      expect(result.extensions.some((r) => isEnabled(r, "one.ts"))).toBe(true);
      expect(result.extensions.some((r) => isDisabled(r, "two.ts"))).toBe(true);
    });

    it("should resolve autoload-disabled project package entries as deltas over global packages", async () => {
      const pkgDir = join(agentDir, "npm", "node_modules", "msa-tools");
      mkdirSync(join(pkgDir, "extensions"), { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "msa-tools", version: "1.0.0" }),
      );
      writeFileSync(join(pkgDir, "extensions", "foo.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "bar.ts"), "export default function() {}");
      settingsManager.setPackages(["npm:msa-tools"]);
      settingsManager.setProjectPackages([
        { source: "npm:msa-tools", autoload: false, extensions: ["-extensions/foo.ts"] },
      ]);
      const runCommandSpy = vi
        .spyOn(packageManager as unknown as PackageManagerInternals, "runCommand")
        .mockRejectedValue(new Error("unexpected install"));

      const result = await packageManager.resolve();
      const states = Object.fromEntries(
        result.extensions.map((resource) => [
          resource.path,
          { enabled: resource.enabled, scope: resource.metadata.scope },
        ]),
      );
      expect(runCommandSpy).not.toHaveBeenCalled();
      expect(states[join(pkgDir, "extensions", "foo.ts")]).toEqual({
        enabled: false,
        scope: "project",
      });
      expect(states[join(pkgDir, "extensions", "bar.ts")]).toEqual({
        enabled: true,
        scope: "user",
      });
    });

    it("should resolve autoload-disabled package entries as positive-only without a global package", async () => {
      vi.stubEnv("HOME", tempDir);
      const pkgDir = join(tempDir, "positive-only-pkg");
      mkdirSync(join(pkgDir, "extensions"), { recursive: true });
      mkdirSync(join(pkgDir, "skills", "foo"), { recursive: true });
      writeFileSync(join(pkgDir, "extensions", "foo.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "bar.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "skills", "foo", "SKILL.md"), "# Foo\n");
      settingsManager.setProjectPackages([
        {
          source: relative(join(tempDir, ".msa"), pkgDir),
          autoload: false,
          extensions: ["+extensions/foo.ts"],
        },
      ]);

      const result = await packageManager.resolve();

      expect(result.extensions.map((resource) => resource.path)).toEqual([
        join(pkgDir, "extensions", "foo.ts"),
      ]);
      expect(result.skills).toEqual([]);
    });
  });

  describe("force-include patterns", () => {
    it("should force-include extensions with + pattern after exclusion", async () => {
      const extDir = join(agentDir, "extensions");
      mkdirSync(extDir, { recursive: true });
      writeFileSync(join(extDir, "keep.ts"), "export default function() {}");
      writeFileSync(join(extDir, "excluded.ts"), "export default function() {}");
      writeFileSync(join(extDir, "force-back.ts"), "export default function() {}");

      settingsManager.setExtensionPaths([
        "extensions",
        "!extensions/*.ts",
        "+extensions/force-back.ts",
      ]);

      const result = await packageManager.resolve();
      expect(result.extensions.some((r) => isDisabled(r, "keep.ts"))).toBe(true);
      expect(result.extensions.some((r) => isDisabled(r, "excluded.ts"))).toBe(true);
      expect(result.extensions.some((r) => isEnabled(r, "force-back.ts"))).toBe(true);
    });

    it("should force-include overrides exclude in package filters", async () => {
      const pkgDir = join(tempDir, "force-pkg");
      mkdirSync(join(pkgDir, "extensions"), { recursive: true });
      writeFileSync(join(pkgDir, "extensions", "alpha.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "beta.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "gamma.ts"), "export default function() {}");

      settingsManager.setPackages([
        {
          source: pkgDir,
          extensions: ["!**/*.ts", "+extensions/beta.ts"],
          skills: [],
          prompts: [],
          themes: [],
        },
      ]);

      const result = await packageManager.resolve();
      expect(result.extensions.some((r) => isDisabled(r, "alpha.ts"))).toBe(true);
      expect(result.extensions.some((r) => isEnabled(r, "beta.ts"))).toBe(true);
      expect(result.extensions.some((r) => isDisabled(r, "gamma.ts"))).toBe(true);
    });

    it("should force-include multiple resources", async () => {
      const pkgDir = join(tempDir, "multi-force-pkg");
      mkdirSync(join(pkgDir, "skills/skill-a"), { recursive: true });
      mkdirSync(join(pkgDir, "skills/skill-b"), { recursive: true });
      mkdirSync(join(pkgDir, "skills/skill-c"), { recursive: true });
      writeFileSync(
        join(pkgDir, "skills/skill-a", "SKILL.md"),
        "---\nname: skill-a\ndescription: A\n---\nContent",
      );
      writeFileSync(
        join(pkgDir, "skills/skill-b", "SKILL.md"),
        "---\nname: skill-b\ndescription: B\n---\nContent",
      );
      writeFileSync(
        join(pkgDir, "skills/skill-c", "SKILL.md"),
        "---\nname: skill-c\ndescription: C\n---\nContent",
      );

      settingsManager.setPackages([
        {
          source: pkgDir,
          extensions: [],
          skills: ["!**/*", "+skills/skill-a", "+skills/skill-c"],
          prompts: [],
          themes: [],
        },
      ]);

      const result = await packageManager.resolve();
      expect(result.skills.some((r) => isEnabled(r, "skill-a", "includes"))).toBe(true);
      expect(result.skills.some((r) => isDisabled(r, "skill-b", "includes"))).toBe(true);
      expect(result.skills.some((r) => isEnabled(r, "skill-c", "includes"))).toBe(true);
    });

    it("should force-include after specific exclusion", async () => {
      const extDir = join(agentDir, "extensions");
      mkdirSync(extDir, { recursive: true });
      writeFileSync(join(extDir, "a.ts"), "export default function() {}");
      writeFileSync(join(extDir, "b.ts"), "export default function() {}");

      settingsManager.setExtensionPaths(["extensions", "!extensions/b.ts", "+extensions/b.ts"]);

      const result = await packageManager.resolve();
      expect(result.extensions.some((r) => isEnabled(r, "a.ts"))).toBe(true);
      expect(result.extensions.some((r) => isEnabled(r, "b.ts"))).toBe(true);
    });

    it("should handle force-include in manifest patterns", async () => {
      const pkgDir = join(tempDir, "manifest-force-pkg");
      mkdirSync(join(pkgDir, "extensions"), { recursive: true });
      writeFileSync(join(pkgDir, "extensions", "one.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "two.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "three.ts"), "export default function() {}");
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "manifest-force-pkg",
          msa: {
            extensions: ["extensions", "!**/two.ts", "+extensions/two.ts"],
          },
        }),
      );

      const result = await packageManager.resolveExtensionSources([pkgDir]);
      expect(result.extensions.some((r) => isEnabled(r, "one.ts"))).toBe(true);
      expect(result.extensions.some((r) => isEnabled(r, "two.ts"))).toBe(true);
      expect(result.extensions.some((r) => isEnabled(r, "three.ts"))).toBe(true);
    });
  });
});
