import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { packagePaths } = packageManagerSupport;

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const shouldOnlyLoadIndexTsFromSubdirectories = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "multifile-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions", "subagent"));

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "subagent", "index.ts"),
        `import { helper } from "./agents.ts";
export default function(api) { api.registerTool({ name: "test", description: "test", execute: async () => helper() }); }`,
      );

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "subagent", "agents.ts"),
        `export function helper() { return "helper"; }`,
      );

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "standalone.ts"),
        "export default function(api) {}",
      );

      const result = yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([pkgDir]),
      );

      expect(
        result.extensions.some(
          (r) => packagePaths.pathEndsWith(r.path, "subagent/index.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(
        result.extensions.some(
          (r) => packagePaths.pathEndsWith(r.path, "standalone.ts") && r.enabled,
        ),
      ).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "agents.ts"))).toBe(
        false,
      );
    }),
  );

const shouldRespectPackageJsonMsaExtensionsManifest = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "manifest-subdir-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions", "custom"));

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "custom", "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["./main.ts"],
          },
        }),
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "custom", "main.ts"),
        "export default function(api) {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "custom", "utils.ts"),
        "export const util = 1;",
      );

      const result = yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([pkgDir]),
      );

      expect(
        result.extensions.some(
          (r) => packagePaths.pathEndsWith(r.path, "custom/main.ts") && r.enabled,
        ),
      ).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "utils.ts"))).toBe(
        false,
      );
    }),
  );

const shouldHandleMixedTopLevelFilesAnd = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "mixed-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions", "complex"));

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "simple.ts"),
        "export default function(api) {}",
      );

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "complex", "index.ts"),
        "import { a } from './a.ts'; export default function(api) {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "complex", "a.ts"),
        "export const a = 1;",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "complex", "b.ts"),
        "export const b = 2;",
      );

      const result = yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([pkgDir]),
      );

      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "simple.ts") && r.enabled),
      ).toBe(true);
      expect(
        result.extensions.some(
          (r) => packagePaths.pathEndsWith(r.path, "complex/index.ts") && r.enabled,
        ),
      ).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "complex/a.ts"))).toBe(
        false,
      );
      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "complex/b.ts"))).toBe(
        false,
      );

      expect(result.extensions.filter((r) => r.enabled).length).toBe(2);
    }),
  );

const shouldSkipSubdirectoriesWithoutIndexTsOr = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "no-entry-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions", "broken"));

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "broken", "helper.ts"),
        "export const x = 1;",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "broken", "another.ts"),
        "export const y = 2;",
      );

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "valid.ts"),
        "export default function(api) {}",
      );

      const result = yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([pkgDir]),
      );

      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "valid.ts") && r.enabled),
      ).toBe(true);
      expect(result.extensions.filter((r) => r.enabled).length).toBe(1);
    }),
  );

describe("DefaultPackageManager", () => {
  describe("multi-file extension discovery (issue #1102)", () => {
    it(
      "should only load index.ts from subdirectories, not helper modules",
      shouldOnlyLoadIndexTsFromSubdirectories,
    );

    it(
      "should respect package.json msa.extensions manifest in subdirectories",
      shouldRespectPackageJsonMsaExtensionsManifest,
    );

    it("should handle mixed top-level files and subdirectories", shouldHandleMixedTopLevelFilesAnd);

    it(
      "should skip subdirectories without index.ts or manifest",
      shouldSkipSubdirectoriesWithoutIndexTsOr,
    );
  });
});
