import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager, type ProgressEvent } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { type PackageManagerInternals } from "./package-manager-support.ts";

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

  describe("npmCommand", () => {
    it("should load legacy pnpm global package paths from pnpm list output", async () => {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["pnpm"],
        packages: ["npm:pnpm-pkg"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const pnpmRoot = join(tempDir, "pnpm", "global", "v11");
      const packagePath = join(pnpmRoot, "20-hash", "node_modules", "pnpm-pkg");
      mkdirSync(join(packagePath, "extensions"), { recursive: true });
      writeFileSync(
        join(packagePath, "package.json"),
        JSON.stringify({ name: "pnpm-pkg", version: "1.0.0" }),
      );
      writeFileSync(join(packagePath, "extensions", "index.ts"), "export default function() {};");

      vi.spyOn(packageManager as any, "runCommandSync").mockImplementation(
        (...callArgs: unknown[]) => {
          const [command, args] = callArgs as [string, string[]];
          if (command !== "pnpm") {
            throw new Error(`unexpected command ${command}`);
          }
          if (args.join(" ") === "list -g --depth 0 --json") {
            return JSON.stringify([
              {
                path: pnpmRoot,
                dependencies: { "pnpm-pkg": { version: "1.0.0", path: packagePath } },
              },
            ]);
          }
          throw new Error(`unexpected args ${args.join(" ")}`);
        },
      );
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      const result = await packageManager.resolve();

      expect(
        result.extensions.some(
          (r) => r.path === join(packagePath, "extensions", "index.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(runCommandSpy).not.toHaveBeenCalled();
      expect(packageManager.getInstalledPath("npm:pnpm-pkg", "user")).toBe(packagePath);
    });

    it("should resolve wrapped pnpm global package paths from pnpm list output", () => {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["mise", "exec", "node@20", "--", "pnpm"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const pnpmRoot = join(tempDir, "pnpm", "global", "v11");
      const packagePath = join(pnpmRoot, "20-hash", "node_modules", "pnpm-pkg");
      mkdirSync(packagePath, { recursive: true });

      vi.spyOn(packageManager as any, "runCommandSync").mockImplementation(
        (...callArgs: unknown[]) => {
          const [command, args] = callArgs as [string, string[]];
          expect(command).toBe("mise");
          if (args.join(" ") === "exec node@20 -- pnpm list -g --depth 0 --json") {
            return JSON.stringify([
              { path: pnpmRoot, dependencies: { "pnpm-pkg": { path: packagePath } } },
            ]);
          }
          throw new Error(`unexpected args ${args.join(" ")}`);
        },
      );

      expect(packageManager.getInstalledPath("npm:pnpm-pkg", "user")).toBe(packagePath);
    });

    it("should ignore malformed legacy pnpm global package lists", () => {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["pnpm"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      vi.spyOn(packageManager as any, "runCommandSync").mockReturnValue("not json");

      expect(packageManager.getInstalledPath("npm:pnpm-pkg", "user")).toBeUndefined();
    });
  });

  describe("source parsing", () => {
    it("should emit progress events on install attempt", async () => {
      const events: ProgressEvent[] = [];
      packageManager.setProgressCallback((event) => events.push(event));
      vi.spyOn(
        packageManager as unknown as PackageManagerInternals,
        "runCommand",
      ).mockRejectedValue(new Error("simulated npm install failure"));

      await expect(packageManager.install("npm:nonexistent-package@1.0.0")).rejects.toThrow(
        "simulated npm install failure",
      );

      expect(events.some((e) => e.type === "start" && e.action === "install")).toBe(true);
      expect(events.some((e) => e.type === "error")).toBe(true);
    });

    it("should recognize github URLs without git: prefix", async () => {
      const events: ProgressEvent[] = [];
      packageManager.setProgressCallback((event) => events.push(event));
      const runCommand = vi
        .spyOn(packageManager as unknown as PackageManagerInternals, "runCommand")
        .mockRejectedValue(new Error("simulated git clone failure"));
      const source = "https://github.com/nonexistent/repo";

      await expect(packageManager.install(source)).rejects.toThrow("simulated git clone failure");

      expect(runCommand).toHaveBeenCalledWith("git", ["clone", source, expect.any(String)]);
      expect(events.some((e) => e.type === "start" && e.action === "install")).toBe(true);
    });

    it("should parse package source types from docs examples", () => {
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
      expect((packageManager as any).parseSource("https://github.com/user/repo@v1").type).toBe(
        "git",
      );
      expect((packageManager as any).parseSource("git:git@github.com:user/repo@v1").type).toBe(
        "git",
      );
      expect((packageManager as any).parseSource("ssh://git@github.com/user/repo@v1").type).toBe(
        "git",
      );

      expect((packageManager as any).parseSource("/absolute/path/to/package").type).toBe("local");
      expect((packageManager as any).parseSource("./relative/path/to/package").type).toBe("local");
      expect((packageManager as any).parseSource("../relative/path/to/package").type).toBe("local");
    });

    it("should never parse dot-relative paths as git", () => {
      const dotSlash = (packageManager as any).parseSource("./packages/agent-timers");
      expect(dotSlash.type).toBe("local");
      expect(dotSlash.path).toBe("./packages/agent-timers");

      const dotDotSlash = (packageManager as any).parseSource("../packages/agent-timers");
      expect(dotDotSlash.type).toBe("local");
      expect(dotDotSlash.path).toBe("../packages/agent-timers");
    });
  });

  describe("git install paths", () => {
    it("should reject paths outside git install roots", () => {
      const managerWithInternals = packageManager as unknown as PackageManagerInternals;
      const traversalSource = {
        type: "git" as const,
        repo: "git@evil.example:../../victim/repo",
        host: "evil.example",
        path: "../../victim/repo",
        pinned: false,
      };

      for (const scope of ["user", "project", "temporary"] as const) {
        expect(() => managerWithInternals.getGitInstallPath(traversalSource, scope)).toThrow(
          "outside package install root",
        );
      }
    });
  });
});
