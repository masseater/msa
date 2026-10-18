import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { pathEndsWith } from "./package-manager-support.ts";

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

  describe("multi-file extension discovery (issue #1102)", () => {
    it("should only load index.ts from subdirectories, not helper modules", async () => {
      const pkgDir = join(tempDir, "multifile-pkg");
      mkdirSync(join(pkgDir, "extensions", "subagent"), { recursive: true });

      writeFileSync(
        join(pkgDir, "extensions", "subagent", "index.ts"),
        `import { helper } from "./agents.ts";
export default function(api) { api.registerTool({ name: "test", description: "test", execute: async () => helper() }); }`,
      );

      writeFileSync(
        join(pkgDir, "extensions", "subagent", "agents.ts"),
        `export function helper() { return "helper"; }`,
      );

      writeFileSync(join(pkgDir, "extensions", "standalone.ts"), "export default function(api) {}");

      const result = await packageManager.resolveExtensionSources([pkgDir]);

      expect(
        result.extensions.some((r) => pathEndsWith(r.path, "subagent/index.ts") && r.enabled),
      ).toBe(true);
      expect(
        result.extensions.some((r) => pathEndsWith(r.path, "standalone.ts") && r.enabled),
      ).toBe(true);

      expect(result.extensions.some((r) => pathEndsWith(r.path, "agents.ts"))).toBe(false);
    });

    it("should respect package.json msa.extensions manifest in subdirectories", async () => {
      const pkgDir = join(tempDir, "manifest-subdir-pkg");
      mkdirSync(join(pkgDir, "extensions", "custom"), { recursive: true });

      writeFileSync(
        join(pkgDir, "extensions", "custom", "package.json"),
        JSON.stringify({
          msa: {
            extensions: ["./main.ts"],
          },
        }),
      );
      writeFileSync(
        join(pkgDir, "extensions", "custom", "main.ts"),
        "export default function(api) {}",
      );
      writeFileSync(join(pkgDir, "extensions", "custom", "utils.ts"), "export const util = 1;");

      const result = await packageManager.resolveExtensionSources([pkgDir]);

      expect(
        result.extensions.some((r) => pathEndsWith(r.path, "custom/main.ts") && r.enabled),
      ).toBe(true);

      expect(result.extensions.some((r) => pathEndsWith(r.path, "utils.ts"))).toBe(false);
    });

    it("should handle mixed top-level files and subdirectories", async () => {
      const pkgDir = join(tempDir, "mixed-pkg");
      mkdirSync(join(pkgDir, "extensions", "complex"), { recursive: true });

      writeFileSync(join(pkgDir, "extensions", "simple.ts"), "export default function(api) {}");

      writeFileSync(
        join(pkgDir, "extensions", "complex", "index.ts"),
        "import { a } from './a.ts'; export default function(api) {}",
      );
      writeFileSync(join(pkgDir, "extensions", "complex", "a.ts"), "export const a = 1;");
      writeFileSync(join(pkgDir, "extensions", "complex", "b.ts"), "export const b = 2;");

      const result = await packageManager.resolveExtensionSources([pkgDir]);

      expect(result.extensions.some((r) => pathEndsWith(r.path, "simple.ts") && r.enabled)).toBe(
        true,
      );
      expect(
        result.extensions.some((r) => pathEndsWith(r.path, "complex/index.ts") && r.enabled),
      ).toBe(true);

      expect(result.extensions.some((r) => pathEndsWith(r.path, "complex/a.ts"))).toBe(false);
      expect(result.extensions.some((r) => pathEndsWith(r.path, "complex/b.ts"))).toBe(false);

      expect(result.extensions.filter((r) => r.enabled).length).toBe(2);
    });

    it("should skip subdirectories without index.ts or manifest", async () => {
      const pkgDir = join(tempDir, "no-entry-pkg");
      mkdirSync(join(pkgDir, "extensions", "broken"), { recursive: true });

      writeFileSync(join(pkgDir, "extensions", "broken", "helper.ts"), "export const x = 1;");
      writeFileSync(join(pkgDir, "extensions", "broken", "another.ts"), "export const y = 2;");

      writeFileSync(join(pkgDir, "extensions", "valid.ts"), "export default function(api) {}");

      const result = await packageManager.resolveExtensionSources([pkgDir]);

      expect(result.extensions.some((r) => pathEndsWith(r.path, "valid.ts") && r.enabled)).toBe(
        true,
      );
      expect(result.extensions.filter((r) => r.enabled).length).toBe(1);
    });
  });

  describe("offline mode and network timeouts", () => {
    it("should update npm range packages using the configured spec", async () => {
      const installedPath = join(tempDir, ".msa", "npm", "node_modules", "example");
      mkdirSync(installedPath, { recursive: true });
      writeFileSync(
        join(installedPath, "package.json"),
        JSON.stringify({ name: "example", version: "1.0.0" }),
      );
      settingsManager.setProjectPackages(["npm:example@^1.0.0"]);

      const runCommandCaptureSpy = vi
        .spyOn(packageManager as any, "runCommandCapture")
        .mockResolvedValue('["1.0.0","1.2.0"]');
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      await packageManager.update("npm:example");

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
          join(tempDir, ".msa", "npm"),
          "--legacy-peer-deps",
        ],
        undefined,
      );
    });

    it("should skip project npm update when installed version matches latest", async () => {
      const installedPath = join(tempDir, ".msa", "npm", "node_modules", "example");
      mkdirSync(installedPath, { recursive: true });
      writeFileSync(
        join(installedPath, "package.json"),
        JSON.stringify({ name: "example", version: "1.3.1" }),
      );
      settingsManager.setProjectPackages(["npm:example@^1.0.0"]);

      const runCommandCaptureSpy = vi
        .spyOn(packageManager as any, "runCommandCapture")
        .mockResolvedValue('["1.0.0","1.3.1","1.0.2"]');
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      await packageManager.update("npm:example");

      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example@^1.0.0", "version", "--json"],
        expect.objectContaining({ cwd: tempDir, timeoutMs: expect.any(Number) }),
      );
      expect(runCommandSpy).not.toHaveBeenCalled();
    });

    it("should skip npm updates when the installed version is newer than the registry version", async () => {
      const installedPath = join(tempDir, ".msa", "npm", "node_modules", "example");
      mkdirSync(installedPath, { recursive: true });
      writeFileSync(
        join(installedPath, "package.json"),
        JSON.stringify({ name: "example", version: "2.0.0" }),
      );
      settingsManager.setProjectPackages(["npm:example"]);

      const runCommandCaptureSpy = vi
        .spyOn(packageManager as any, "runCommandCapture")
        .mockResolvedValue('"1.9.0"');
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      await packageManager.update("npm:example");

      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example", "version", "--json"],
        expect.objectContaining({ cwd: tempDir, timeoutMs: expect.any(Number) }),
      );
      expect(runCommandSpy).not.toHaveBeenCalled();
    });
  });
});
