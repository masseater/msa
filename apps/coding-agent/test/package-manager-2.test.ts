import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { packagePaths } = packageManagerSupport;

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const shouldAutoDiscoverProjectPromptsWithOverrides = () =>
  runTest(
    Effect.gen(function* () {
      const promptsDir = joinPath(fixture.tempDir, ".msa", "prompts");
      yield* makeDirectory(promptsDir);
      const promptPath = joinPath(promptsDir, "is.md");
      yield* writeTextFile(promptPath, "Is prompt");

      fixture.settingsManager.resources.setProjectPromptTemplatePaths(["!prompts/is.md"]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.prompts.some((r) => r.path === promptPath && !r.enabled)).toBe(true);
    }),
  );

const shouldResolveDirectoryWithPackageJsonMsa = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "my-extensions-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["./extensions/clip.ts", "./extensions/cost.ts"],
          },
          name: "my-extensions-pkg",
        }),
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "clip.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "cost.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(joinPath(pkgDir, "extensions", "helper.ts"), "export const x = 1;");

      fixture.settingsManager.resources.setExtensionPaths([pkgDir]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());

      expect(
        result.extensions.some(
          (r) => r.path === joinPath(pkgDir, "extensions", "clip.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(
        result.extensions.some(
          (r) => r.path === joinPath(pkgDir, "extensions", "cost.ts") && r.enabled,
        ),
      ).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "helper.ts"))).toBe(
        false,
      );
    }),
  );

describe("DefaultPackageManager", () => {
  describe("resolve", () => {
    it(
      "should auto-discover project prompts with overrides",
      shouldAutoDiscoverProjectPromptsWithOverrides,
    );

    it(
      "should resolve directory with package.json msa.extensions in extensions setting",
      shouldResolveDirectoryWithPackageJsonMsa,
    );
  });
});
