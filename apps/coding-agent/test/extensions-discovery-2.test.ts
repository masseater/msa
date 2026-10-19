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
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";

describe("extensions discovery 2", () => {
  let tempDir: string;
  let extensionsDir: string;
  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = yield* makeTempDir("msa-ext-test-");
        extensionsDir = joinPath(tempDir, "extensions");
        yield* makeDirectory(extensionsDir);
      }),
    ),
  );
  afterEach(() => runTest(removePath(tempDir)));
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
  it("keeps package.json msa extension entries with leading tilde package-relative", () =>
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
            name: "tilde-package",
            msa: {
              extensions: ["~entry.ts", "~/entry.ts"],
            },
          }),
        );

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions.map((extension) => extension.path).sort()).toEqual(
          [directExtensionPath, slashExtensionPath].sort(),
        );
      }),
    ));
  it("package.json can declare multiple extensions", () =>
    runTest(
      Effect.gen(function* () {
        const subdir = joinPath(extensionsDir, "my-package");
        yield* makeDirectory(subdir);
        yield* writeTextFile(joinPath(subdir, "ext1.ts"), extensionCode);
        yield* writeTextFile(joinPath(subdir, "ext2.ts"), extensionCode);
        yield* writeTextFile(
          joinPath(subdir, "package.json"),
          yield* toJsonText({
            name: "my-package",
            msa: {
              extensions: ["./ext1.ts", "./ext2.ts"],
            },
          }),
        );

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(2);
      }),
    ));
  it("package.json with msa field takes precedence over index.ts", () =>
    runTest(
      Effect.gen(function* () {
        const subdir = joinPath(extensionsDir, "my-package");
        yield* makeDirectory(subdir);
        yield* writeTextFile(joinPath(subdir, "index.ts"), extensionCodeWithTool("from-index"));
        yield* writeTextFile(joinPath(subdir, "custom.ts"), extensionCodeWithTool("from-custom"));
        yield* writeTextFile(
          joinPath(subdir, "package.json"),
          yield* toJsonText({
            name: "my-package",
            msa: {
              extensions: ["./custom.ts"],
            },
          }),
        );

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(1);
        expect(result.extensions[0]?.path).toContain("custom.ts");

        expect(result.extensions[0]?.tools.has("from-custom")).toBe(true);
        expect(result.extensions[0]?.tools.has("from-index")).toBe(false);
      }),
    ));
  it("ignores package.json without msa field, falls back to index.ts", () =>
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
    ));
  it("ignores subdirectory without index or package.json", () =>
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
    ));
  it("does not recurse beyond one level", () =>
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
    ));
  it("handles mixed direct files and subdirectories", () =>
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
    ));
  it("skips non-existent paths declared in package.json", () =>
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
    ));
  it("loads extensions and registers commands", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(joinPath(extensionsDir, "with-command.ts"), extensionCode);

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(1);
        expect(result.extensions[0]?.commands.has("test")).toBe(true);
      }),
    ));
  it("loads extensions and registers tools", () =>
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
    ));
});
