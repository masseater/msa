import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { nodeFs, packagePaths, type PackageManagerInternals } from "./package-manager-support.ts";
import { Effect } from "effect";
import { joinPath, makeDirectory, makeTempDir, relativePath, removePath, runTest } from "@msa/testing";
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

  describe("temporary install paths", () => {
    it("should place temporary npm packages under the agent temp extension folder", () => {
      const managerWithInternals = packageManager as unknown as PackageManagerInternals;
      const source = managerWithInternals.parseSource("npm:left-pad");
      if (source.type !== "npm") {
        throw new Error("Expected npm source");
      }

      const installPath = managerWithInternals.getNpmInstallPath(source, "temporary");
      const tempRoot = joinPath(agentDir, "tmp", "extensions");

      expect(packagePaths.pathEndsWith(installPath, "node_modules/left-pad")).toBe(true);
      expect(relativePath(tempRoot, installPath).startsWith("..")).toBe(false);
      expect(installPath.startsWith(joinPath(tempDir, "msa-extensions"))).toBe(false);
      if (process.platform !== "win32") {
        expect(nodeFs.statSync(tempRoot).mode & 0o777).toBe(0o700);
      }
    });
  });

  describe("settings source normalization", () => {
    it("should store global local packages relative to agent settings base", () => {
      const pkgDir = joinPath(tempDir, "packages", "local-global-pkg");
      nodeFs.mkdirSync(joinPath(pkgDir, "extensions"), { recursive: true });
      nodeFs.writeFileSync(joinPath(pkgDir, "extensions", "index.ts"), "export default function() {}");

      const added = packageManager.addSourceToSettings("./packages/local-global-pkg");
      expect(added).toBe(true);

      const settings = settingsManager.getGlobalSettings();
      const rel = relativePath(agentDir, pkgDir);
      const expected = rel.startsWith(".") ? rel : `./${rel}`;
      expect(settings.packages?.[0]).toBe(expected);
    });

    it("should store project local packages relative to .msa settings base", () => {
      const projectPkgDir = joinPath(tempDir, "project-local-pkg");
      nodeFs.mkdirSync(joinPath(projectPkgDir, "extensions"), { recursive: true });
      nodeFs.writeFileSync(joinPath(projectPkgDir, "extensions", "index.ts"), "export default function() {}");

      const added = packageManager.addSourceToSettings("./project-local-pkg", { local: true });
      expect(added).toBe(true);

      const settings = settingsManager.getProjectSettings();
      const rel = relativePath(joinPath(tempDir, ".msa"), projectPkgDir);
      const expected = rel.startsWith(".") ? rel : `./${rel}`;
      expect(settings.packages?.[0]).toBe(expected);
    });

    it("should remove local package entries using equivalent path forms", () => {
      const pkgDir = joinPath(tempDir, "remove-local-pkg");
      nodeFs.mkdirSync(joinPath(pkgDir, "extensions"), { recursive: true });
      nodeFs.writeFileSync(joinPath(pkgDir, "extensions", "index.ts"), "export default function() {}");

      packageManager.addSourceToSettings("./remove-local-pkg");
      const removed = packageManager.removeSourceFromSettings(`${pkgDir}/`);
      expect(removed).toBe(true);
      expect(settingsManager.getGlobalSettings().packages ?? []).toHaveLength(0);
    });

    it("should return false when adding the same git source with the same ref", () => {
      const first = packageManager.addSourceToSettings("git:github.com/user/repo@v1");
      expect(first).toBe(true);

      const second = packageManager.addSourceToSettings("git:github.com/user/repo@v1");
      expect(second).toBe(false);
      expect(settingsManager.getGlobalSettings().packages).toEqual(["git:github.com/user/repo@v1"]);
    });

    it("should update the ref when adding the same git source with a different ref", () => {
      packageManager.addSourceToSettings("git:github.com/user/repo@v1");

      const updated = packageManager.addSourceToSettings("git:github.com/user/repo@v2");
      expect(updated).toBe(true);
      expect(settingsManager.getGlobalSettings().packages).toEqual(["git:github.com/user/repo@v2"]);
    });

    it("should preserve package filters when replacing a package source ref", () => {
      settingsManager.setPackages([
        {
          source: "git:github.com/user/repo@v1",
          extensions: ["extensions/main.ts"],
          skills: [],
          prompts: ["prompts/review.md"],
          themes: ["themes/dark.json"],
        },
      ]);

      const updated = packageManager.addSourceToSettings("git:github.com/user/repo@v2");
      expect(updated).toBe(true);
      expect(settingsManager.getGlobalSettings().packages).toEqual([
        {
          source: "git:github.com/user/repo@v2",
          extensions: ["extensions/main.ts"],
          skills: [],
          prompts: ["prompts/review.md"],
          themes: ["themes/dark.json"],
        },
      ]);
    });
  });

  describe("HTTPS git URL parsing (old behavior)", () => {
    it("should parse HTTPS GitHub URLs correctly", () => runTest(
Effect.sync(() => {

      const parsed = (packageManager as any).parseSource("https://github.com/user/repo");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
      expect(parsed.pinned).toBe(false);
    
}),
));

    it("should parse HTTPS URLs with git: prefix", () => runTest(
Effect.sync(() => {

      const parsed = (packageManager as any).parseSource("git:https://github.com/user/repo");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
    
}),
));

    it("should parse HTTPS URLs with ref", () => runTest(
Effect.sync(() => {

      const parsed = (packageManager as any).parseSource("https://github.com/user/repo@v1.2.3");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
      expect(parsed.ref).toBe("v1.2.3");
      expect(parsed.pinned).toBe(true);
    
}),
));

    it("should parse host/path shorthand only with git: prefix", () => runTest(
Effect.sync(() => {

      const parsed = (packageManager as any).parseSource("git:github.com/user/repo");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
    
}),
));

    it("should treat host/path shorthand as local without git: prefix", () => runTest(
Effect.sync(() => {

      const parsed = (packageManager as any).parseSource("github.com/user/repo");
      expect(parsed.type).toBe("local");
    
}),
));

    it("should parse HTTPS URLs with .git suffix", () => runTest(
Effect.sync(() => {

      const parsed = (packageManager as any).parseSource("https://github.com/user/repo.git");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("github.com");
      expect(parsed.path).toBe("user/repo");
    
}),
));

    it("should parse GitLab HTTPS URLs", () => runTest(
Effect.sync(() => {

      const parsed = (packageManager as any).parseSource("https://gitlab.com/user/repo");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("gitlab.com");
      expect(parsed.path).toBe("user/repo");
    
}),
));

    it("should parse Bitbucket HTTPS URLs", () => runTest(
Effect.sync(() => {

      const parsed = (packageManager as any).parseSource("https://bitbucket.org/user/repo");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("bitbucket.org");
      expect(parsed.path).toBe("user/repo");
    
}),
));

    it("should parse Codeberg HTTPS URLs", () => runTest(
Effect.sync(() => {

      const parsed = (packageManager as any).parseSource("https://codeberg.org/user/repo");
      expect(parsed.type).toBe("git");
      expect(parsed.host).toBe("codeberg.org");
      expect(parsed.path).toBe("user/repo");
    
}),
));

    it("should generate correct package identity for protocol and git:-prefixed URLs", () => runTest(
Effect.sync(() => {

      const identity1 = (packageManager as any).getPackageIdentity("https://github.com/user/repo");
      const identity2 = (packageManager as any).getPackageIdentity(
        "https://github.com/user/repo@v1.0.0",
      );
      const identity3 = (packageManager as any).getPackageIdentity("git:github.com/user/repo");
      const identity4 = (packageManager as any).getPackageIdentity(
        "https://github.com/user/repo.git",
      );

      expect(identity1).toBe("git:github.com/user/repo");
      expect(identity2).toBe("git:github.com/user/repo");
      expect(identity3).toBe("git:github.com/user/repo");
      expect(identity4).toBe("git:github.com/user/repo");
    
}),
));
  });
});
