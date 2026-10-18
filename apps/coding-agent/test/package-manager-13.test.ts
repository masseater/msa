import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { isEnabled, isDisabled } from "./package-manager-support.ts";

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

  describe("force-include patterns", () => {
    it("should force-include themes", async () => {
      const themesDir = join(agentDir, "themes");
      mkdirSync(themesDir, { recursive: true });
      writeFileSync(join(themesDir, "dark.json"), "{}");
      writeFileSync(join(themesDir, "light.json"), "{}");
      writeFileSync(join(themesDir, "special.json"), "{}");

      settingsManager.setThemePaths(["themes", "!themes/*.json", "+themes/special.json"]);

      const result = await packageManager.resolve();
      expect(result.themes.some((r) => isDisabled(r, "dark.json"))).toBe(true);
      expect(result.themes.some((r) => isDisabled(r, "light.json"))).toBe(true);
      expect(result.themes.some((r) => isEnabled(r, "special.json"))).toBe(true);
    });

    it("should force-include prompts", async () => {
      const promptsDir = join(agentDir, "prompts");
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(join(promptsDir, "review.md"), "Review");
      writeFileSync(join(promptsDir, "explain.md"), "Explain");
      writeFileSync(join(promptsDir, "debug.md"), "Debug");

      settingsManager.setPromptTemplatePaths(["prompts", "!prompts/*.md", "+prompts/debug.md"]);

      const result = await packageManager.resolve();
      expect(result.prompts.some((r) => isDisabled(r, "review.md"))).toBe(true);
      expect(result.prompts.some((r) => isDisabled(r, "explain.md"))).toBe(true);
      expect(result.prompts.some((r) => isEnabled(r, "debug.md"))).toBe(true);
    });
  });

  describe("force-exclude patterns", () => {
    it("should force-exclude top-level resources", async () => {
      const extDir = join(agentDir, "extensions");
      mkdirSync(extDir, { recursive: true });
      writeFileSync(join(extDir, "alpha.ts"), "export default function() {}");
      writeFileSync(join(extDir, "beta.ts"), "export default function() {}");

      settingsManager.setExtensionPaths([
        "extensions",
        "+extensions/alpha.ts",
        "-extensions/alpha.ts",
      ]);

      const result = await packageManager.resolve();
      expect(result.extensions.some((r) => isDisabled(r, "alpha.ts"))).toBe(true);
      expect(result.extensions.some((r) => isEnabled(r, "beta.ts"))).toBe(true);
    });

    it("should force-exclude in package filters", async () => {
      const pkgDir = join(tempDir, "force-exclude-pkg");
      mkdirSync(join(pkgDir, "extensions"), { recursive: true });
      writeFileSync(join(pkgDir, "extensions", "alpha.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "beta.ts"), "export default function() {}");

      settingsManager.setPackages([
        {
          source: pkgDir,
          extensions: ["extensions/*.ts", "+extensions/alpha.ts", "-extensions/alpha.ts"],
          skills: [],
          prompts: [],
          themes: [],
        },
      ]);

      const result = await packageManager.resolve();
      expect(result.extensions.some((r) => isDisabled(r, "alpha.ts"))).toBe(true);
      expect(result.extensions.some((r) => isEnabled(r, "beta.ts"))).toBe(true);
    });
  });

  describe("package deduplication", () => {
    it("should dedupe same local package in global and project (project wins)", async () => {
      const pkgDir = join(tempDir, "shared-pkg");
      mkdirSync(join(pkgDir, "extensions"), { recursive: true });
      writeFileSync(join(pkgDir, "extensions", "shared.ts"), "export default function() {}");

      settingsManager.setPackages([pkgDir]);
      settingsManager.setProjectPackages([pkgDir]);

      const globalSettings = settingsManager.getGlobalSettings();
      const projectSettings = settingsManager.getProjectSettings();
      expect(globalSettings.packages).toEqual([pkgDir]);
      expect(projectSettings.packages).toEqual([pkgDir]);

      const result = await packageManager.resolve();

      const sharedPaths = result.extensions.filter((r) => r.path.includes("shared-pkg"));
      expect(sharedPaths.length).toBe(1);
      expect(sharedPaths[0]?.metadata.scope).toBe("project");
    });

    it("should keep both if different packages", async () => {
      const pkg1Dir = join(tempDir, "pkg1");
      const pkg2Dir = join(tempDir, "pkg2");
      mkdirSync(join(pkg1Dir, "extensions"), { recursive: true });
      mkdirSync(join(pkg2Dir, "extensions"), { recursive: true });
      writeFileSync(join(pkg1Dir, "extensions", "from-pkg1.ts"), "export default function() {}");
      writeFileSync(join(pkg2Dir, "extensions", "from-pkg2.ts"), "export default function() {}");

      settingsManager.setPackages([pkg1Dir]);
      settingsManager.setProjectPackages([pkg2Dir]);

      const result = await packageManager.resolve();
      expect(result.extensions.some((r) => r.path.includes("pkg1"))).toBe(true);
      expect(result.extensions.some((r) => r.path.includes("pkg2"))).toBe(true);
    });

    it("should dedupe SSH and HTTPS URLs for same repo", async () => {
      const httpsUrl = "https://github.com/user/repo";
      const sshUrl = "git:git@github.com:user/repo";

      const httpsIdentity = (packageManager as any).getPackageIdentity(httpsUrl);
      const sshIdentity = (packageManager as any).getPackageIdentity(sshUrl);

      expect(httpsIdentity).toBe("git:github.com/user/repo");
      expect(sshIdentity).toBe("git:github.com/user/repo");
      expect(httpsIdentity).toBe(sshIdentity);
    });

    it("should dedupe SSH and HTTPS with refs", async () => {
      const httpsUrl = "https://github.com/user/repo@v1.0.0";
      const sshUrl = "git:git@github.com:user/repo@v1.0.0";

      const httpsIdentity = (packageManager as any).getPackageIdentity(httpsUrl);
      const sshIdentity = (packageManager as any).getPackageIdentity(sshUrl);

      expect(httpsIdentity).toBe("git:github.com/user/repo");
      expect(sshIdentity).toBe("git:github.com/user/repo");
      expect(httpsIdentity).toBe(sshIdentity);
    });

    it("should dedupe SSH URL with ssh:// protocol and git@ format", async () => {
      const sshProtocol = "ssh://git@github.com/user/repo";
      const gitAt = "git:git@github.com:user/repo";

      const sshProtocolIdentity = (packageManager as any).getPackageIdentity(sshProtocol);
      const gitAtIdentity = (packageManager as any).getPackageIdentity(gitAt);

      expect(sshProtocolIdentity).toBe("git:github.com/user/repo");
      expect(gitAtIdentity).toBe("git:github.com/user/repo");
      expect(sshProtocolIdentity).toBe(gitAtIdentity);
    });

    it("should dedupe all supported URL formats for same repo", async () => {
      const urls = [
        "https://github.com/user/repo",
        "https://github.com/user/repo.git",
        "ssh://git@github.com/user/repo",
        "git:https://github.com/user/repo",
        "git:github.com/user/repo",
        "git:git@github.com:user/repo",
        "git:git@github.com:user/repo.git",
      ];

      const identities = urls.map((url) => (packageManager as any).getPackageIdentity(url));

      const uniqueIdentities = [...new Set(identities)];
      expect(uniqueIdentities.length).toBe(1);
      expect(uniqueIdentities[0]).toBe("git:github.com/user/repo");
    });

    it("should keep different repos separate (HTTPS vs SSH)", async () => {
      const repo1Https = "https://github.com/user/repo1";
      const repo2Ssh = "git:git@github.com:user/repo2";

      const id1 = (packageManager as any).getPackageIdentity(repo1Https);
      const id2 = (packageManager as any).getPackageIdentity(repo2Ssh);

      expect(id1).toBe("git:github.com/user/repo1");
      expect(id2).toBe("git:github.com/user/repo2");
      expect(id1).not.toBe(id2);
    });
  });
});
