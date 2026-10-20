import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import loader from "../src/core/extensions/loader.ts";

const { discoverAndLoadExtensions } = loader;

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let tempDir: string;

let extensionsDir: string;

const extensionCode = `
		export default function(msa) {
			msa.registerCommand("test", { handler: async () => {} });
		}
	`;

const extensionCodeWithTool = (toolName: string) => `
		import { Type } from "typebox";
		export default function(msa) {
			msa.registerTool({
				name: "${toolName}",
				label: "${toolName}",
				description: "Test tool",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
			});
		}
	`;

const keepsPackageJsonMsaExtensionEntriesWith = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extensionsDir, "tilde-package");
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

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions.map((extension) => extension.path).sort()).toEqual(
        [directExtensionPath, slashExtensionPath].sort(),
      );
    }),
  );

const packageJsonCanDeclareMultipleExtensions = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extensionsDir, "my-package");
      yield* makeDirectory(subdir);
      yield* writeTextFile(joinPath(subdir, "ext1.ts"), extensionCode);
      yield* writeTextFile(joinPath(subdir, "ext2.ts"), extensionCode);
      yield* writeTextFile(
        joinPath(subdir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["./ext1.ts", "./ext2.ts"],
          },
          name: "my-package",
        }),
      );

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(2);
    }),
  );

const packageJsonWithMsaFieldTakesPrecedence = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extensionsDir, "my-package");
      yield* makeDirectory(subdir);
      yield* writeTextFile(joinPath(subdir, "index.ts"), extensionCodeWithTool("from-index"));
      yield* writeTextFile(joinPath(subdir, "custom.ts"), extensionCodeWithTool("from-custom"));
      yield* writeTextFile(
        joinPath(subdir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["./custom.ts"],
          },
          name: "my-package",
        }),
      );

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0]?.path).toContain("custom.ts");

      expect(result.extensions[0]?.tools.has("from-custom")).toBe(true);
      expect(result.extensions[0]?.tools.has("from-index")).toBe(false);
    }),
  );

const ignoresPackageJsonWithoutMsaFieldFalls = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extensionsDir, "my-package");
      yield* makeDirectory(subdir);
      yield* writeTextFile(joinPath(subdir, "index.ts"), extensionCode);
      yield* writeTextFile(
        joinPath(subdir, "package.json"),
        yield* toJsonText({
          name: "my-package",
          version: "1.0.0",
        }),
      );

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0]?.path).toContain("index.ts");
    }),
  );

const ignoresSubdirectoryWithoutIndexOrPackageJson = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extensionsDir, "not-an-extension");
      yield* makeDirectory(subdir);
      yield* writeTextFile(joinPath(subdir, "helper.ts"), extensionCode);
      yield* writeTextFile(joinPath(subdir, "utils.ts"), extensionCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(0);
    }),
  );

const doesNotRecurseBeyondOneLevel = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extensionsDir, "container");
      const nested = joinPath(subdir, "nested");
      yield* makeDirectory(subdir);
      yield* makeDirectory(nested);
      yield* writeTextFile(joinPath(nested, "index.ts"), extensionCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(0);
    }),
  );

const handlesMixedDirectFilesAndSubdirectories = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(extensionsDir, "direct.ts"), extensionCode);

      const subdir1 = joinPath(extensionsDir, "with-index");
      yield* makeDirectory(subdir1);
      yield* writeTextFile(joinPath(subdir1, "index.ts"), extensionCode);

      const subdir2 = joinPath(extensionsDir, "with-manifest");
      yield* makeDirectory(subdir2);
      yield* writeTextFile(joinPath(subdir2, "entry.ts"), extensionCode);
      yield* writeTextFile(
        joinPath(subdir2, "package.json"),
        yield* toJsonText({ msa: { extensions: ["./entry.ts"] } }),
      );

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(3);
    }),
  );

const skipsNonExistentPathsDeclaredInPackage = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extensionsDir, "my-package");
      yield* makeDirectory(subdir);
      yield* writeTextFile(joinPath(subdir, "exists.ts"), extensionCode);
      yield* writeTextFile(
        joinPath(subdir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["./exists.ts", "./missing.ts"],
          },
        }),
      );

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0]?.path).toContain("exists.ts");
    }),
  );

const loadsExtensionsAndRegistersCommands = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(extensionsDir, "with-command.ts"), extensionCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0]?.commands.has("test")).toBe(true);
    }),
  );

const loadsExtensionsAndRegistersTools = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(
        joinPath(extensionsDir, "with-tool.ts"),
        extensionCodeWithTool("my-tool"),
      );

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0]?.tools.has("my-tool")).toBe(true);
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("msa-ext-test-");
      extensionsDir = joinPath(tempDir, "extensions");
      yield* makeDirectory(extensionsDir);
    }),
  );

describe("extensions discovery 2", () => {
  beforeEach(beforeEachHook);
  afterEach(() => runTest(removePath(tempDir)));
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
