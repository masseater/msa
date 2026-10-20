import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { readEnv } from "../src/core/process-env.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { packagePaths } = packageManagerSupport;

const {
  awaited,
  joinPath,
  makeDirectory,
  makeSymlink,
  makeTempDir,
  relativePath,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let settingsManager: SettingsManager;

let packageManager: DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldExpandPositiveGlobManifestEntriesBefore = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "skill-manifest-glob-pkg");
      yield* makeDirectory(joinPath(pkgDir, "plugins/pdf-to-markdown/skills/pdf-to-markdown"));
      yield* makeDirectory(joinPath(pkgDir, "plugins/nutrient-dws/skills/document-processor-api"));
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
          msa: {
            skills: ["./plugins/*/skills"],
          },
          name: "skill-manifest-glob-pkg",
        }),
      );

      const result = yield* awaited(packageManager.resolveExtensionSources([pkgDir]));
      expect(
        result.skills.some((r) => packagePaths.isEnabled(r, "pdf-to-markdown", "includes")),
      ).toBe(true);
      expect(
        result.skills.some((r) => packagePaths.isEnabled(r, "document-processor-api", "includes")),
      ).toBe(true);
    }),
  );

const shouldSortManifestGlobMatchesAndUsePart1 = () =>
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
    yield* writeTextFile(joinPath(extensionGroupDir, "index.ts"), "export default function() {}");
    yield* writeTextFile(
      joinPath(pkgDir, "plugins", "local", "skills", "local-skill", "SKILL.md"),
      "---\nname: local-skill\ndescription: Local\n---\n",
    );
    return { linkedPluginSource, pkgDir };
  });

const shouldSortManifestGlobMatchesAndUse = () =>
  runTest(
    Effect.gen(function* () {
      const { linkedPluginSource, pkgDir } = yield* shouldSortManifestGlobMatchesAndUsePart1();
      yield* writeTextFile(
        joinPath(linkedPluginSource, "skills", "linked-skill", "SKILL.md"),
        "---\nname: linked-skill\ndescription: Linked\n---\n",
      );
      yield* makeSymlink(linkedPluginSource, joinPath(pkgDir, "plugins", "linked"));
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: [
              "./extension-files/*.ts",
              "./extension-files/**/.ignored.ts",
              "./extension-files/nested/.hidden.ts",
              "./extension-groups/*/",
            ],
            skills: ["./plugins/*/skills", "./plugins/linked/skills"],
          },
          name: "manifest-glob-semantics-pkg",
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
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      previousOfflineEnv = readEnv("MSA_OFFLINE");
      vi.stubEnv("MSA_OFFLINE", undefined);
      tempDir = yield* makeTempDir("pm-test-");
      agentDir = joinPath(tempDir, "agent");
      yield* makeDirectory(agentDir);

      settingsManager = SettingsManager.inMemory();
      packageManager = new DefaultPackageManager({
        agentDir,
        cwd: tempDir,
        settingsManager,
      });
    }),
  );

const afterEachHook = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  describe("pattern filtering in msa manifest", () => {
    it(
      "should expand positive glob manifest entries before collecting skills",
      shouldExpandPositiveGlobManifestEntriesBefore,
    );

    it(
      "should sort manifest glob matches and use exact entries for dot paths and symlink traversal",
      shouldSortManifestGlobMatchesAndUse,
    );
  });
});
