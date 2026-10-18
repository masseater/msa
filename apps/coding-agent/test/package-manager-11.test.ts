import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { pathEndsWith, isEnabled, isDisabled } from "./package-manager-support.ts";

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

  describe("pattern filtering in msa manifest", () => {
    it("should expand positive glob manifest entries before collecting skills", async () => {
      const pkgDir = join(tempDir, "skill-manifest-glob-pkg");
      mkdirSync(join(pkgDir, "plugins/pdf-to-markdown/skills/pdf-to-markdown"), {
        recursive: true,
      });
      mkdirSync(join(pkgDir, "plugins/nutrient-dws/skills/document-processor-api"), {
        recursive: true,
      });
      writeFileSync(
        join(pkgDir, "plugins/pdf-to-markdown/skills/pdf-to-markdown", "SKILL.md"),
        "---\nname: pdf-to-markdown\ndescription: PDF to Markdown\n---\nContent",
      );
      writeFileSync(
        join(pkgDir, "plugins/nutrient-dws/skills/document-processor-api", "SKILL.md"),
        "---\nname: document-processor-api\ndescription: DWS\n---\nContent",
      );
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "skill-manifest-glob-pkg",
          msa: {
            skills: ["./plugins/*/skills"],
          },
        }),
      );

      const result = await packageManager.resolveExtensionSources([pkgDir]);
      expect(result.skills.some((r) => isEnabled(r, "pdf-to-markdown", "includes"))).toBe(true);
      expect(result.skills.some((r) => isEnabled(r, "document-processor-api", "includes"))).toBe(
        true,
      );
    });

    it("should sort manifest glob matches and use exact entries for dot paths and symlink traversal", async () => {
      const pkgDir = join(tempDir, "manifest-glob-semantics-pkg");
      const extensionFilesDir = join(pkgDir, "extension-files");
      const extensionGroupDir = join(pkgDir, "extension-groups", "group");
      const linkedPluginSource = join(pkgDir, "linked-plugin-source");
      mkdirSync(join(extensionFilesDir, "nested"), { recursive: true });
      mkdirSync(extensionGroupDir, { recursive: true });
      mkdirSync(join(pkgDir, "plugins", "local", "skills", "local-skill"), { recursive: true });
      mkdirSync(join(linkedPluginSource, "skills", "linked-skill"), { recursive: true });
      writeFileSync(join(extensionFilesDir, "z.ts"), "export default function() {}");
      writeFileSync(join(extensionFilesDir, "a.ts"), "export default function() {}");
      writeFileSync(join(extensionFilesDir, ".ignored.ts"), "export default function() {}");
      writeFileSync(
        join(extensionFilesDir, "nested", ".hidden.ts"),
        "export default function() {}",
      );
      writeFileSync(join(extensionGroupDir, "index.ts"), "export default function() {}");
      writeFileSync(
        join(pkgDir, "plugins", "local", "skills", "local-skill", "SKILL.md"),
        "---\nname: local-skill\ndescription: Local\n---\n",
      );
      writeFileSync(
        join(linkedPluginSource, "skills", "linked-skill", "SKILL.md"),
        "---\nname: linked-skill\ndescription: Linked\n---\n",
      );
      symlinkSync(
        linkedPluginSource,
        join(pkgDir, "plugins", "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "manifest-glob-semantics-pkg",
          msa: {
            extensions: [
              "./extension-files/*.ts",
              "./extension-files/**/.ignored.ts",
              "./extension-files/nested/.hidden.ts",
              "./extension-groups/*/",
            ],
            skills: ["./plugins/*/skills", "./plugins/linked/skills"],
          },
        }),
      );

      const result = await packageManager.resolveExtensionSources([pkgDir]);
      expect(result.extensions.map((resource) => relative(pkgDir, resource.path))).toEqual([
        join("extension-files", "a.ts"),
        join("extension-files", "z.ts"),
        join("extension-files", "nested", ".hidden.ts"),
        join("extension-groups", "group", "index.ts"),
      ]);
      expect(
        result.skills.some((resource) => pathEndsWith(resource.path, "local-skill/SKILL.md")),
      ).toBe(true);
      expect(
        result.skills.some((resource) => pathEndsWith(resource.path, "linked-skill/SKILL.md")),
      ).toBe(true);
    });
  });

  describe("pattern filtering in package filters", () => {
    it("should apply user filters on top of manifest filters (not replace)", async () => {
      const pkgDir = join(tempDir, "layered-pkg");
      mkdirSync(join(pkgDir, "extensions"), { recursive: true });
      writeFileSync(join(pkgDir, "extensions", "foo.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "bar.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "baz.ts"), "export default function() {}");
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "layered-pkg",
          msa: {
            extensions: ["extensions", "!**/baz.ts"],
          },
        }),
      );

      settingsManager.setPackages([
        {
          source: pkgDir,
          extensions: ["!**/bar.ts"],
          skills: [],
          prompts: [],
          themes: [],
        },
      ]);

      const result = await packageManager.resolve();

      expect(result.extensions.some((r) => isEnabled(r, "foo.ts"))).toBe(true);

      expect(result.extensions.some((r) => isDisabled(r, "bar.ts"))).toBe(true);

      expect(result.extensions.some((r) => pathEndsWith(r.path, "baz.ts"))).toBe(false);
    });

    it("should exclude extensions from package with ! pattern", async () => {
      const pkgDir = join(tempDir, "pattern-pkg");
      mkdirSync(join(pkgDir, "extensions"), { recursive: true });
      writeFileSync(join(pkgDir, "extensions", "foo.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "bar.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "baz.ts"), "export default function() {}");

      settingsManager.setPackages([
        {
          source: pkgDir,
          extensions: ["!**/baz.ts"],
          skills: [],
          prompts: [],
          themes: [],
        },
      ]);

      const result = await packageManager.resolve();
      expect(result.extensions.some((r) => isEnabled(r, "foo.ts"))).toBe(true);
      expect(result.extensions.some((r) => isEnabled(r, "bar.ts"))).toBe(true);
      expect(result.extensions.some((r) => isDisabled(r, "baz.ts"))).toBe(true);
    });

    it("should filter themes from package", async () => {
      const pkgDir = join(tempDir, "theme-pkg");
      mkdirSync(join(pkgDir, "themes"), { recursive: true });
      writeFileSync(join(pkgDir, "themes", "nice.json"), "{}");
      writeFileSync(join(pkgDir, "themes", "ugly.json"), "{}");

      settingsManager.setPackages([
        {
          source: pkgDir,
          extensions: [],
          skills: [],
          prompts: [],
          themes: ["!ugly.json"],
        },
      ]);

      const result = await packageManager.resolve();
      expect(result.themes.some((r) => isEnabled(r, "nice.json"))).toBe(true);
      expect(result.themes.some((r) => isDisabled(r, "ugly.json"))).toBe(true);
    });

    it("should combine include and exclude patterns", async () => {
      const pkgDir = join(tempDir, "combo-pkg");
      mkdirSync(join(pkgDir, "extensions"), { recursive: true });
      writeFileSync(join(pkgDir, "extensions", "alpha.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "beta.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "gamma.ts"), "export default function() {}");

      settingsManager.setPackages([
        {
          source: pkgDir,
          extensions: ["**/alpha.ts", "**/beta.ts", "!**/beta.ts"],
          skills: [],
          prompts: [],
          themes: [],
        },
      ]);

      const result = await packageManager.resolve();
      expect(result.extensions.some((r) => isEnabled(r, "alpha.ts"))).toBe(true);
      expect(result.extensions.some((r) => isDisabled(r, "beta.ts"))).toBe(true);
      expect(result.extensions.some((r) => isDisabled(r, "gamma.ts"))).toBe(true);
    });
  });
});
