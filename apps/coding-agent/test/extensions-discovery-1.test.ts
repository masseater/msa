import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import loader from "../src/core/extensions/loader.ts";

const { discoverAndLoadExtensions } = loader;

const {
  awaited,
  basenameOf,
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

const discoversDirectTsFilesInExtensions = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(extensionsDir, "foo.ts"), extensionCode);
      yield* writeTextFile(joinPath(extensionsDir, "bar.ts"), extensionCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(2);
      expect(result.extensions.map((e) => basenameOf(e.path)).sort()).toEqual(["bar.ts", "foo.ts"]);
    }),
  );

const loadsTheCodingAgentEntrypointWithoutRewriting = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(
        joinPath(extensionsDir, "coding-agent-import.ts"),
        `
				import { getAgentDir } from "@msa/coding-agent";
				void getAgentDir;
				export default function(msa) {
					msa.registerCommand("test", { handler: async () => {} });
				}
			`,
      );

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(1);
    }),
  );

const doesNotInferPackageOwnershipFromAncestor = () =>
  runTest(
    Effect.gen(function* () {
      const dependencyDir = joinPath(tempDir, "node_modules", "@msa", "coding-agent");
      yield* makeDirectory(dependencyDir);
      yield* writeTextFile(
        joinPath(tempDir, "package.json"),
        yield* toJsonText({
          dependencies: { "@msa/coding-agent": "1.0.0" },
          name: "application",
          type: "module" as const,
        }),
      );
      yield* writeTextFile(
        joinPath(dependencyDir, "package.json"),
        yield* toJsonText({
          exports: "./index.js",
          name: "@msa/coding-agent",
          type: "module" as const,
        }),
      );
      yield* writeTextFile(
        joinPath(dependencyDir, "index.js"),
        "export const physicalDependency = true;",
      );
      yield* writeTextFile(
        joinPath(extensionsDir, "compiled-esm-extension.js"),
        `
				import { physicalDependency } from "@msa/coding-agent";
				export default function(msa) {
					if (physicalDependency) msa.registerCommand("physical-dependency", { handler: async () => {} });
				}
			`,
      );

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toEqual([]);
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0]?.commands.has("physical-dependency")).toBe(true);
      expect(result.warnings).toEqual([]);
    }),
  );

const keepsTheTypeOnlyMsaAiOauth = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(
        joinPath(extensionsDir, "oauth-import.ts"),
        `
				import * as oauth from "@msa/ai/oauth";
				void oauth;
				export default function(msa) {
					msa.registerCommand("test", { handler: async () => {} });
				}
			`,
      );

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toEqual([]);
      expect(result.extensions).toHaveLength(1);
    }),
  );

const discoversDirectJsFilesInExtensions = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(extensionsDir, "foo.js"), extensionCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(1);
      const [extension] = result.extensions;
      if (extension === undefined) throw new Error("expected a loaded extension");
      expect(basenameOf(extension.path)).toBe("foo.js");
    }),
  );

const discoversSubdirectoryWithIndexTs = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extensionsDir, "my-extension");
      yield* makeDirectory(subdir);
      yield* writeTextFile(joinPath(subdir, "index.ts"), extensionCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0]?.path).toContain("my-extension");
      expect(result.extensions[0]?.path).toContain("index.ts");
    }),
  );

const discoversSubdirectoryWithIndexJs = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extensionsDir, "my-extension");
      yield* makeDirectory(subdir);
      yield* writeTextFile(joinPath(subdir, "index.js"), extensionCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0]?.path).toContain("index.js");
    }),
  );

const prefersIndexTsOverIndexJs = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extensionsDir, "my-extension");
      yield* makeDirectory(subdir);
      yield* writeTextFile(joinPath(subdir, "index.ts"), extensionCode);
      yield* writeTextFile(joinPath(subdir, "index.js"), extensionCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0]?.path).toContain("index.ts");
    }),
  );

const discoversSubdirectoryWithPackageJsonMsaField = () =>
  runTest(
    Effect.gen(function* () {
      const subdir = joinPath(extensionsDir, "my-package");
      const srcDir = joinPath(subdir, "src");
      yield* makeDirectory(subdir);
      yield* makeDirectory(srcDir);
      yield* writeTextFile(joinPath(srcDir, "main.ts"), extensionCode);
      yield* writeTextFile(
        joinPath(subdir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["./src/main.ts"],
          },
          name: "my-package",
        }),
      );

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.errors).toHaveLength(0);
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0]?.path).toContain("src");
      expect(result.extensions[0]?.path).toContain("main.ts");
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

describe("extensions discovery 1", () => {
  beforeEach(beforeEachHook);
  afterEach(() => runTest(removePath(tempDir)));
  it("discovers direct .ts files in extensions/", discoversDirectTsFilesInExtensions);
  it(
    "loads the coding-agent entrypoint without rewriting msa-ai provider subpaths",
    loadsTheCodingAgentEntrypointWithoutRewriting,
  );
  it(
    "does not infer package ownership from ancestor manifests",
    doesNotInferPackageOwnershipFromAncestor,
  );
  it(
    "keeps the type-only msa-ai OAuth compatibility barrel resolvable",
    keepsTheTypeOnlyMsaAiOauth,
  );
  it("discovers direct .js files in extensions/", discoversDirectJsFilesInExtensions);
  it("discovers subdirectory with index.ts", discoversSubdirectoryWithIndexTs);
  it("discovers subdirectory with index.js", discoversSubdirectoryWithIndexJs);
  it("prefers index.ts over index.js", prefersIndexTsOverIndexJs);
  it(
    "discovers subdirectory with package.json msa field",
    discoversSubdirectoryWithPackageJsonMsaField,
  );
});
