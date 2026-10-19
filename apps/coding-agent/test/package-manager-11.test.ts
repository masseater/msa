import {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  relativePath,
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

  describe("pattern filtering in msa manifest", () => {
    it("should expand positive glob manifest entries before collecting skills", () =>
      runTest(
        Effect.gen(function* () {
          const pkgDir = joinPath(tempDir, "skill-manifest-glob-pkg");
          yield* makeDirectory(joinPath(pkgDir, "plugins/pdf-to-markdown/skills/pdf-to-markdown"));
          yield* makeDirectory(
            joinPath(pkgDir, "plugins/nutrient-dws/skills/document-processor-api"),
          );
          yield* writeTextFile(
            joinPath(pkgDir, "plugins/pdf-to-markdown/skills/pdf-to-markdown", "SKILL.md"),
            "---\nname: pdf-to-markdown\ndescription: PDF to Markdown\n---\nContent",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "plugins/nutrient-dws/skills/document-processor-api", "SKILL.md"),
            "---\nname: document-processor-api\ndescription: DWS\n---\nContent",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "package.json"),
            yield* toJsonText({
              name: "skill-manifest-glob-pkg",
              msa: {
                skills: ["./plugins/*/skills"],
              },
            }),
          );

          const result = yield* awaited(packageManager.resolveExtensionSources([pkgDir]));
          expect(
            result.skills.some((r) => packagePaths.isEnabled(r, "pdf-to-markdown", "includes")),
          ).toBe(true);
          expect(
            result.skills.some((r) =>
              packagePaths.isEnabled(r, "document-processor-api", "includes"),
            ),
          ).toBe(true);
        }),
      ));

    it("should sort manifest glob matches and use exact entries for dot paths and symlink traversal", () =>
      runTest(
        Effect.gen(function* () {
          const pkgDir = joinPath(tempDir, "manifest-glob-semantics-pkg");
          const extensionFilesDir = joinPath(pkgDir, "extension-files");
          const extensionGroupDir = joinPath(pkgDir, "extension-groups", "group");
          const linkedPluginSource = joinPath(pkgDir, "linked-plugin-source");
          yield* makeDirectory(joinPath(extensionFilesDir, "nested"));
          yield* makeDirectory(extensionGroupDir);
          yield* makeDirectory(joinPath(pkgDir, "plugins", "local", "skills", "local-skill"));
          yield* makeDirectory(joinPath(linkedPluginSource, "skills", "linked-skill"));
          yield* writeTextFile(joinPath(extensionFilesDir, "z.ts"), "export default function() {}");
          yield* writeTextFile(joinPath(extensionFilesDir, "a.ts"), "export default function() {}");
          yield* writeTextFile(
            joinPath(extensionFilesDir, ".ignored.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(extensionFilesDir, "nested", ".hidden.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(extensionGroupDir, "index.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "plugins", "local", "skills", "local-skill", "SKILL.md"),
            "---\nname: local-skill\ndescription: Local\n---\n",
          );
          yield* writeTextFile(
            joinPath(linkedPluginSource, "skills", "linked-skill", "SKILL.md"),
            "---\nname: linked-skill\ndescription: Linked\n---\n",
          );
          nodeFs.symlinkSync(
            linkedPluginSource,
            joinPath(pkgDir, "plugins", "linked"),
            process.platform === "win32" ? "junction" : "dir",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "package.json"),
            yield* toJsonText({
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

          const result = yield* awaited(packageManager.resolveExtensionSources([pkgDir]));
          expect(result.extensions.map((resource) => relativePath(pkgDir, resource.path))).toEqual([
            joinPath("extension-files", "a.ts"),
            joinPath("extension-files", "z.ts"),
            joinPath("extension-files", "nested", ".hidden.ts"),
            joinPath("extension-groups", "group", "index.ts"),
          ]);
          expect(
            result.skills.some((resource) =>
              packagePaths.pathEndsWith(resource.path, "local-skill/SKILL.md"),
            ),
          ).toBe(true);
          expect(
            result.skills.some((resource) =>
              packagePaths.pathEndsWith(resource.path, "linked-skill/SKILL.md"),
            ),
          ).toBe(true);
        }),
      ));
  });

  describe("pattern filtering in package filters", () => {
    it("should apply user filters on top of manifest filters (not replace)", () =>
      runTest(
        Effect.gen(function* () {
          const pkgDir = joinPath(tempDir, "layered-pkg");
          yield* makeDirectory(joinPath(pkgDir, "extensions"));
          yield* writeTextFile(
            joinPath(pkgDir, "extensions", "foo.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "extensions", "bar.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "extensions", "baz.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "package.json"),
            yield* toJsonText({
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

          const result = yield* awaited(packageManager.resolve());

          expect(result.extensions.some((r) => packagePaths.isEnabled(r, "foo.ts"))).toBe(true);

          expect(result.extensions.some((r) => packagePaths.isDisabled(r, "bar.ts"))).toBe(true);

          expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "baz.ts"))).toBe(
            false,
          );
        }),
      ));

    it("should exclude extensions from package with ! pattern", () =>
      runTest(
        Effect.gen(function* () {
          const pkgDir = joinPath(tempDir, "pattern-pkg");
          yield* makeDirectory(joinPath(pkgDir, "extensions"));
          yield* writeTextFile(
            joinPath(pkgDir, "extensions", "foo.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "extensions", "bar.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "extensions", "baz.ts"),
            "export default function() {}",
          );

          settingsManager.setPackages([
            {
              source: pkgDir,
              extensions: ["!**/baz.ts"],
              skills: [],
              prompts: [],
              themes: [],
            },
          ]);

          const result = yield* awaited(packageManager.resolve());
          expect(result.extensions.some((r) => packagePaths.isEnabled(r, "foo.ts"))).toBe(true);
          expect(result.extensions.some((r) => packagePaths.isEnabled(r, "bar.ts"))).toBe(true);
          expect(result.extensions.some((r) => packagePaths.isDisabled(r, "baz.ts"))).toBe(true);
        }),
      ));

    it("should filter themes from package", () =>
      runTest(
        Effect.gen(function* () {
          const pkgDir = joinPath(tempDir, "theme-pkg");
          yield* makeDirectory(joinPath(pkgDir, "themes"));
          yield* writeTextFile(joinPath(pkgDir, "themes", "nice.json"), "{}");
          yield* writeTextFile(joinPath(pkgDir, "themes", "ugly.json"), "{}");

          settingsManager.setPackages([
            {
              source: pkgDir,
              extensions: [],
              skills: [],
              prompts: [],
              themes: ["!ugly.json"],
            },
          ]);

          const result = yield* awaited(packageManager.resolve());
          expect(result.themes.some((r) => packagePaths.isEnabled(r, "nice.json"))).toBe(true);
          expect(result.themes.some((r) => packagePaths.isDisabled(r, "ugly.json"))).toBe(true);
        }),
      ));

    it("should combine include and exclude patterns", () =>
      runTest(
        Effect.gen(function* () {
          const pkgDir = joinPath(tempDir, "combo-pkg");
          yield* makeDirectory(joinPath(pkgDir, "extensions"));
          yield* writeTextFile(
            joinPath(pkgDir, "extensions", "alpha.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "extensions", "beta.ts"),
            "export default function() {}",
          );
          yield* writeTextFile(
            joinPath(pkgDir, "extensions", "gamma.ts"),
            "export default function() {}",
          );

          settingsManager.setPackages([
            {
              source: pkgDir,
              extensions: ["**/alpha.ts", "**/beta.ts", "!**/beta.ts"],
              skills: [],
              prompts: [],
              themes: [],
            },
          ]);

          const result = yield* awaited(packageManager.resolve());
          expect(result.extensions.some((r) => packagePaths.isEnabled(r, "alpha.ts"))).toBe(true);
          expect(result.extensions.some((r) => packagePaths.isDisabled(r, "beta.ts"))).toBe(true);
          expect(result.extensions.some((r) => packagePaths.isDisabled(r, "gamma.ts"))).toBe(true);
        }),
      ));
  });
});
