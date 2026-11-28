import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import loader from "../src/core/extensions/loader.ts";
import extensionsDiscoverySupport from "./extensions-discovery-support.ts";
import tempDirKit from "./temp-dir.ts";

const { discoverAndLoadExtensions } = loader;

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const {
  discoverCleanly,
  extensionCode,
  extensionCodeWithTool,
  writeExtensionFiles,
  writeExtensionPackage,
} = extensionsDiscoverySupport;

const { useExtensionsDir } = tempDirKit;

const extTemp = useExtensionsDir("msa-ext-test-");

const keepsPackageJsonMsaExtensionEntriesWith = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extTemp.extensionsDir, "tilde-package");
      const directExtensionPath = joinPath(subdir, "~entry.ts");
      const slashExtensionPath = joinPath(subdir, "~", "entry.ts");
      yield* makeDirectory(joinPath(subdir, "~"));
      yield* writeTextFile(directExtensionPath, extensionCode);
      yield* writeTextFile(slashExtensionPath, extensionCode);
      yield* writeTextFile(
        joinPath(subdir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["~entry.ts", "~/entry.ts"],
          },
          name: "tilde-package",
        }),
      );

      const result = yield* awaited(discoverAndLoadExtensions([], extTemp.path, extTemp.path));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions.map((extension) => extension.path).sort()).toEqual(
        [directExtensionPath, slashExtensionPath].sort(),
      );
    }),
  );

const packageJsonCanDeclareMultipleExtensions = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeExtensionPackage(
        joinPath(extTemp.extensionsDir, "my-package"),
        { "ext1.ts": extensionCode, "ext2.ts": extensionCode },
        { msa: { extensions: ["./ext1.ts", "./ext2.ts"] }, name: "my-package" },
      );

      yield* discoverCleanly(extTemp, 2);
    }),
  );

const packageJsonWithMsaFieldTakesPrecedence = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeExtensionPackage(
        joinPath(extTemp.extensionsDir, "my-package"),
        {
          "custom.ts": extensionCodeWithTool("from-custom"),
          "index.ts": extensionCodeWithTool("from-index"),
        },
        { msa: { extensions: ["./custom.ts"] }, name: "my-package" },
      );

      const result = yield* discoverCleanly(extTemp, 1);
      expect(result.extensions[0]?.path).toContain("custom.ts");

      expect(result.extensions[0]?.tools.has("from-custom")).toBe(true);
      expect(result.extensions[0]?.tools.has("from-index")).toBe(false);
    }),
  );

const ignoresPackageJsonWithoutMsaFieldFalls = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeExtensionPackage(
        joinPath(extTemp.extensionsDir, "my-package"),
        { "index.ts": extensionCode },
        { name: "my-package", version: "1.0.0" },
      );

      const result = yield* discoverCleanly(extTemp, 1);
      expect(result.extensions[0]?.path).toContain("index.ts");
    }),
  );

const ignoresSubdirectoryWithoutIndexOrPackageJson = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extTemp.extensionsDir, "not-an-extension");
      yield* writeExtensionFiles(subdir, ["helper.ts", "utils.ts"]);

      yield* discoverCleanly(extTemp, 0);
    }),
  );

const doesNotRecurseBeyondOneLevel = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extTemp.extensionsDir, "container");
      const nested = joinPath(subdir, "nested");
      yield* makeDirectory(subdir);
      yield* writeExtensionFiles(nested, ["index.ts"]);

      yield* discoverCleanly(extTemp, 0);
    }),
  );

const handlesMixedDirectFilesAndSubdirectories = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeExtensionFiles(extTemp.extensionsDir, ["direct.ts"]);

      const subdir1 = joinPath(extTemp.extensionsDir, "with-index");
      yield* writeExtensionFiles(subdir1, ["index.ts"]);

      const subdir2 = joinPath(extTemp.extensionsDir, "with-manifest");
      yield* writeExtensionFiles(subdir2, ["entry.ts"]);
      yield* writeTextFile(
        joinPath(subdir2, "package.json"),
        yield* toJsonText({ msa: { extensions: ["./entry.ts"] } }),
      );

      yield* discoverCleanly(extTemp, 3);
    }),
  );

const skipsNonExistentPathsDeclaredInPackage = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeExtensionPackage(
        joinPath(extTemp.extensionsDir, "my-package"),
        { "exists.ts": extensionCode },
        { msa: { extensions: ["./exists.ts", "./missing.ts"] } },
      );

      const result = yield* discoverCleanly(extTemp, 1);
      expect(result.extensions[0]?.path).toContain("exists.ts");
    }),
  );

const loadsExtensionsAndRegistersCommands = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeExtensionFiles(extTemp.extensionsDir, ["with-command.ts"]);

      const result = yield* discoverCleanly(extTemp, 1);
      expect(result.extensions[0]?.commands.has("test")).toBe(true);
    }),
  );

const loadsExtensionsAndRegistersTools = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(
        joinPath(extTemp.extensionsDir, "with-tool.ts"),
        extensionCodeWithTool("my-tool"),
      );

      const result = yield* discoverCleanly(extTemp, 1);
      expect(result.extensions[0]?.tools.has("my-tool")).toBe(true);
    }),
  );

describe("extensions discovery 2", () => {
  it(
    "keeps package.json msa extension entries with leading tilde package-relative",
    keepsPackageJsonMsaExtensionEntriesWith,
  );
  it("package.json can declare multiple extensions", packageJsonCanDeclareMultipleExtensions);
  it(
    "package.json with msa field takes precedence over index.ts",
    packageJsonWithMsaFieldTakesPrecedence,
  );
  it(
    "ignores package.json without msa field, falls back to index.ts",
    ignoresPackageJsonWithoutMsaFieldFalls,
  );
  it(
    "ignores subdirectory without index or package.json",
    ignoresSubdirectoryWithoutIndexOrPackageJson,
  );
  it("does not recurse beyond one level", doesNotRecurseBeyondOneLevel);
  it("handles mixed direct files and subdirectories", handlesMixedDirectFilesAndSubdirectories);
  it("skips non-existent paths declared in package.json", skipsNonExistentPathsDeclaredInPackage);
  it("loads extensions and registers commands", loadsExtensionsAndRegistersCommands);
  it("loads extensions and registers tools", loadsExtensionsAndRegistersTools);
});
