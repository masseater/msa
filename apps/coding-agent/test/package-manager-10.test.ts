import {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { readEnv } from "../src/core/process-env.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { nodeFs, packagePaths } from "./package-manager-support.ts";

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

  describe("HTTPS git URL parsing (old behavior)", () => {
    it("should deduplicate git URLs with different supported formats", () =>
      runTest(
        Effect.sync(() => {
          const pkgDir = joinPath(tempDir, "https-dedup-pkg");
          nodeFs.mkdirSync(joinPath(pkgDir, "extensions"), { recursive: true });
          nodeFs.writeFileSync(
            joinPath(pkgDir, "extensions", "test.ts"),
            "export default function() {}",
          );

          settingsManager.setPackages([
            "https://github.com/user/repo",
            "git:github.com/user/repo",
            "https://github.com/user/repo.git",
          ]);

          const id1 = (packageManager as any).getPackageIdentity("https://github.com/user/repo");
          const id2 = (packageManager as any).getPackageIdentity("git:github.com/user/repo");
          const id3 = (packageManager as any).getPackageIdentity(
            "https://github.com/user/repo.git",
          );

          expect(id1).toBe(id2);
          expect(id2).toBe(id3);
        }),
      ));

    it("should handle HTTPS URLs with refs in resolve", () =>
      runTest(
        Effect.sync(() => {
          const parsed = (packageManager as any).parseSource("https://github.com/user/repo@main");
          expect(parsed.ref).toBe("main");
          expect(parsed.pinned).toBe(true);

          const parsed2 = (packageManager as any).parseSource(
            "https://github.com/user/repo@feature/branch",
          );
          expect(parsed2.ref).toBe("feature/branch");
        }),
      ));
  });

  describe("pattern filtering in top-level arrays", () => {
    it("should expand ~ in exclusion and exact patterns", () =>
      runTest(
        Effect.gen(function* () {
          const previousHome = readEnv("HOME");
          vi.stubEnv("HOME", tempDir);

          try {
            const skillsDir = joinPath(tempDir, "extra", "skills");
            for (const name of ["keep", "glob-excluded", "exact-excluded"]) {
              yield* makeDirectory(joinPath(skillsDir, name));
              yield* writeTextFile(
                joinPath(skillsDir, name, "SKILL.md"),
                `---\nname: ${name}\ndescription: ${name}\n---\n`,
              );
            }

            settingsManager.setSkillPaths([
              "~/extra/skills",
              "!~/extra/skills/glob-*",
              "-~/extra/skills/exact-excluded",
            ]);

            const result = yield* awaited(packageManager.resolve());
            expect(result.skills.some((r) => packagePaths.isEnabled(r, "keep/SKILL.md"))).toBe(
              true,
            );
            expect(
              result.skills.some((r) => packagePaths.isDisabled(r, "glob-excluded/SKILL.md")),
            ).toBe(true);
            expect(
              result.skills.some((r) => packagePaths.isDisabled(r, "exact-excluded/SKILL.md")),
            ).toBe(true);
          } finally {
            if (previousHome === undefined) {
              vi.stubEnv("HOME", undefined);
            } else {
              vi.stubEnv("HOME", previousHome);
            }
          }
        }),
      ));

    it("should exclude extensions with ! pattern", () =>
      runTest(
        Effect.gen(function* () {
          const extDir = joinPath(agentDir, "extensions");
          yield* makeDirectory(extDir);
          yield* writeTextFile(joinPath(extDir, "keep.ts"), "export default function() {}");
          yield* writeTextFile(joinPath(extDir, "remove.ts"), "export default function() {}");

          settingsManager.setExtensionPaths(["extensions", "!**/remove.ts"]);

          const result = yield* awaited(packageManager.resolve());
          expect(result.extensions.some((r) => packagePaths.isEnabled(r, "keep.ts"))).toBe(true);
          expect(result.extensions.some((r) => packagePaths.isDisabled(r, "remove.ts"))).toBe(true);
        }),
      ));

    it("should filter themes with glob patterns", () =>
      runTest(
        Effect.gen(function* () {
          const themesDir = joinPath(agentDir, "themes");
          yield* makeDirectory(themesDir);
          yield* writeTextFile(joinPath(themesDir, "dark.json"), "{}");
          yield* writeTextFile(joinPath(themesDir, "light.json"), "{}");
          yield* writeTextFile(joinPath(themesDir, "funky.json"), "{}");

          settingsManager.setThemePaths(["themes", "!funky.json"]);

          const result = yield* awaited(packageManager.resolve());
          expect(result.themes.some((r) => packagePaths.isEnabled(r, "dark.json"))).toBe(true);
          expect(result.themes.some((r) => packagePaths.isEnabled(r, "light.json"))).toBe(true);
          expect(result.themes.some((r) => packagePaths.isDisabled(r, "funky.json"))).toBe(true);
        }),
      ));

    it("should filter prompts with exclusion pattern", () =>
      runTest(
        Effect.gen(function* () {
          const promptsDir = joinPath(agentDir, "prompts");
          yield* makeDirectory(promptsDir);
          yield* writeTextFile(joinPath(promptsDir, "review.md"), "Review code");
          yield* writeTextFile(joinPath(promptsDir, "explain.md"), "Explain code");

          settingsManager.setPromptTemplatePaths(["prompts", "!explain.md"]);

          const result = yield* awaited(packageManager.resolve());
          expect(result.prompts.some((r) => packagePaths.isEnabled(r, "review.md"))).toBe(true);
          expect(result.prompts.some((r) => packagePaths.isDisabled(r, "explain.md"))).toBe(true);
        }),
      ));

    it("should filter skills with exclusion pattern", () =>
      runTest(
        Effect.gen(function* () {
          const skillsDir = joinPath(agentDir, "skills");
          yield* makeDirectory(joinPath(skillsDir, "good-skill"));
          yield* makeDirectory(joinPath(skillsDir, "bad-skill"));
          yield* writeTextFile(
            joinPath(skillsDir, "good-skill", "SKILL.md"),
            "---\nname: good-skill\ndescription: Good\n---\nContent",
          );
          yield* writeTextFile(
            joinPath(skillsDir, "bad-skill", "SKILL.md"),
            "---\nname: bad-skill\ndescription: Bad\n---\nContent",
          );

          settingsManager.setSkillPaths(["skills", "!**/bad-skill"]);

          const result = yield* awaited(packageManager.resolve());
          expect(
            result.skills.some((r) => packagePaths.isEnabled(r, "good-skill", "includes")),
          ).toBe(true);
          expect(
            result.skills.some((r) => packagePaths.isDisabled(r, "bad-skill", "includes")),
          ).toBe(true);
        }),
      ));

    it("should work without patterns (backward compatible)", () =>
      runTest(
        Effect.gen(function* () {
          const extDir = joinPath(agentDir, "extensions");
          yield* makeDirectory(extDir);
          const extPath = joinPath(extDir, "my-ext.ts");
          yield* writeTextFile(extPath, "export default function() {}");

          settingsManager.setExtensionPaths(["extensions/my-ext.ts"]);

          const result = yield* awaited(packageManager.resolve());
          expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
        }),
      ));
  });

  describe("pattern filtering in msa manifest", () => {
    it("should support glob patterns in manifest extensions", () =>
      runTest(
        Effect.gen(function* () {
          const pkgDir = joinPath(tempDir, "manifest-pkg");
          yield* makeDirectory(joinPath(pkgDir, "extensions"));
          yield* makeDirectory(joinPath(pkgDir, "node_modules/dep/extensions"));
          yield* writeTextFile(
            joinPath(pkgDir, "extensions", "local.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "node_modules/dep/extensions", "remote.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "node_modules/dep/extensions", "skip.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "package.json"),
            yield* toJsonText({
              name: "manifest-pkg",
              msa: {
                extensions: ["extensions", "node_modules/dep/extensions", "!**/skip.ts"],
              },
            }),
          );

          const result = yield* awaited(packageManager.resolveExtensionSources([pkgDir]));
          expect(result.extensions.some((r) => packagePaths.isEnabled(r, "local.ts"))).toBe(true);
          expect(result.extensions.some((r) => packagePaths.isEnabled(r, "remote.ts"))).toBe(true);
          expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "skip.ts"))).toBe(
            false,
          );
        }),
      ));

    it("should support glob patterns in manifest skills", () =>
      runTest(
        Effect.gen(function* () {
          const pkgDir = joinPath(tempDir, "skill-manifest-pkg");
          yield* makeDirectory(joinPath(pkgDir, "skills/good-skill"));
          yield* makeDirectory(joinPath(pkgDir, "skills/bad-skill"));
          yield* writeTextFile(
            joinPath(pkgDir, "skills/good-skill", "SKILL.md"),
            "---\nname: good-skill\ndescription: Good\n---\nContent",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "skills/bad-skill", "SKILL.md"),
            "---\nname: bad-skill\ndescription: Bad\n---\nContent",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "package.json"),
            yield* toJsonText({
              name: "skill-manifest-pkg",
              msa: {
                skills: ["skills", "!**/bad-skill"],
              },
            }),
          );

          const result = yield* awaited(packageManager.resolveExtensionSources([pkgDir]));
          expect(
            result.skills.some((r) => packagePaths.isEnabled(r, "good-skill", "includes")),
          ).toBe(true);
          expect(result.skills.some((r) => r.path.includes("bad-skill"))).toBe(false);
        }),
      ));
  });
});
