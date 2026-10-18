import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

import {
  awaited,
  runTest,
  toJsonText,
  writeTextFile,
  makeDirectory,
  joinPath,
  dirnameOf,
  basenameOf,
  resolvePath,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";

const __dirname = dirnameOf(fileURLToPath(import.meta.url));

describe("extensions discovery", () => {
  let tempDir: string;
  let extensionsDir: string;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = fs.mkdtempSync(joinPath(os.tmpdir(), "msa-ext-test-"));
        extensionsDir = joinPath(tempDir, "extensions");
        yield* makeDirectory(extensionsDir);
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        yield* removePath(tempDir);
      }),
    ),
  );

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

  it("discovers direct .ts files in extensions/", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(joinPath(extensionsDir, "foo.ts"), extensionCode);
        yield* writeTextFile(joinPath(extensionsDir, "bar.ts"), extensionCode);

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(2);
        expect(result.extensions.map((e) => basenameOf(e.path)).sort()).toEqual([
          "bar.ts",
          "foo.ts",
        ]);
      }),
    ));

  it("loads the coding-agent entrypoint without rewriting msa-ai provider subpaths", () =>
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
    ));

  it("does not infer package ownership from ancestor manifests", () =>
    runTest(
      Effect.gen(function* () {
        const dependencyDir = joinPath(tempDir, "node_modules", "@msa", "coding-agent");
        yield* makeDirectory(dependencyDir);
        yield* writeTextFile(
          joinPath(tempDir, "package.json"),
          yield* toJsonText({
            name: "application",
            type: "module" as const,
            dependencies: { "@msa/coding-agent": "1.0.0" },
          }),
        );
        yield* writeTextFile(
          joinPath(dependencyDir, "package.json"),
          yield* toJsonText({
            name: "@msa/coding-agent",
            type: "module" as const,
            exports: "./index.js",
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
    ));

  it("keeps the type-only msa-ai OAuth compatibility barrel resolvable", () =>
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
    ));

  it("discovers direct .js files in extensions/", () =>
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
    ));

  it("discovers subdirectory with index.ts", () =>
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
    ));

  it("discovers subdirectory with index.js", () =>
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
    ));

  it("prefers index.ts over index.js", () =>
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
    ));

  it("discovers subdirectory with package.json msa field", () =>
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
            name: "my-package",
            msa: {
              extensions: ["./src/main.ts"],
            },
          }),
        );

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(1);
        expect(result.extensions[0]?.path).toContain("src");
        expect(result.extensions[0]?.path).toContain("main.ts");
      }),
    ));

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

  it("reports errors for invalid extension code", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(
          joinPath(extensionsDir, "invalid.ts"),
          "this is not valid typescript export",
        );

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.path).toContain("invalid.ts");
        expect(result.extensions).toHaveLength(0);
      }),
    ));

  it("handles explicitly configured paths", () =>
    runTest(
      Effect.gen(function* () {
        const customPath = joinPath(tempDir, "custom-location", "my-ext.ts");
        yield* makeDirectory(dirnameOf(customPath));
        yield* writeTextFile(customPath, extensionCode);

        const result = yield* awaited(discoverAndLoadExtensions([customPath], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(1);
        expect(result.extensions[0]?.path).toContain("my-ext.ts");
      }),
    ));

  it("resolves dependencies from extension's own node_modules", () =>
    runTest(
      Effect.gen(function* () {
        const extPath = resolvePath(__dirname, "../examples/extensions/with-deps");

        const result = yield* awaited(discoverAndLoadExtensions([extPath], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(1);
        expect(result.extensions[0]?.path).toContain("with-deps");

        expect(result.extensions[0]?.tools.has("parse_duration")).toBe(true);
      }),
    ));

  it("registers message and entry renderers", () =>
    runTest(
      Effect.gen(function* () {
        const extCode = `
			export default function(msa) {
				msa.registerMarkdownTransformer((markdown) => {
					return markdown;
				});
				msa.registerMessageRenderer("my-custom-type", (message, options, theme) => {
					return null; // Use default rendering
				});
				msa.registerEntryRenderer("my-entry-type", (entry, options, theme) => {
					return null;
				});
			}
		`;
        yield* writeTextFile(joinPath(extensionsDir, "with-renderer.ts"), extCode);

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(1);
        expect(result.extensions[0]?.markdownTransformer).toBeDefined();
        expect(result.extensions[0]?.messageRenderers.has("my-custom-type")).toBe(true);
        expect(result.extensions[0]?.entryRenderers?.has("my-entry-type")).toBe(true);
      }),
    ));

  it("reports error when extension throws during initialization", () =>
    runTest(
      Effect.gen(function* () {
        const extCode = `
			export default function(msa) {
				throw new Error("Initialization failed!");
			}
		`;
        yield* writeTextFile(joinPath(extensionsDir, "throws.ts"), extCode);

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.error).toContain("Initialization failed!");
        expect(result.extensions).toHaveLength(0);
      }),
    ));

  it("reports error when extension has no default export", () =>
    runTest(
      Effect.gen(function* () {
        const extCode = `
			export function notDefault(msa) {
				msa.registerCommand("test", { handler: async () => {} });
			}
		`;
        yield* writeTextFile(joinPath(extensionsDir, "no-default.ts"), extCode);

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.error).toContain("does not export a valid factory function");
        expect(result.extensions).toHaveLength(0);
      }),
    ));

  it("allows multiple extensions to register different tools", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(joinPath(extensionsDir, "tool-a.ts"), extensionCodeWithTool("tool-a"));
        yield* writeTextFile(joinPath(extensionsDir, "tool-b.ts"), extensionCodeWithTool("tool-b"));

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(2);

        const allTools = new Set<string>();
        for (const ext of result.extensions) {
          for (const name of ext.tools.keys()) {
            allTools.add(name);
          }
        }
        expect(allTools.has("tool-a")).toBe(true);
        expect(allTools.has("tool-b")).toBe(true);
      }),
    ));

  it("loads extension with event handlers", () =>
    runTest(
      Effect.gen(function* () {
        const extCode = `
			export default function(msa) {
				msa.on("agent_start", async () => {});
				msa.on("tool_call", async (event) => undefined);
				msa.on("agent_end", async () => {});
			}
		`;
        yield* writeTextFile(joinPath(extensionsDir, "with-handlers.ts"), extCode);

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(1);
        expect(result.extensions[0]?.handlers.has("agent_start")).toBe(true);
        expect(result.extensions[0]?.handlers.has("tool_call")).toBe(true);
        expect(result.extensions[0]?.handlers.has("agent_end")).toBe(true);
      }),
    ));

  it("loads extension with shortcuts", () =>
    runTest(
      Effect.gen(function* () {
        const extCode = `
			export default function(msa) {
				msa.registerShortcut("ctrl+t", {
					description: "Test shortcut",
					handler: async (ctx) => {},
				});
			}
		`;
        yield* writeTextFile(joinPath(extensionsDir, "with-shortcut.ts"), extCode);

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(1);
        expect(result.extensions[0]?.shortcuts.has("ctrl+t")).toBe(true);
      }),
    ));

  it("loads extension with flags", () =>
    runTest(
      Effect.gen(function* () {
        const extCode = `
			export default function(msa) {
				msa.registerFlag("my-flag", {
					description: "My custom flag",
					handler: async (value) => {},
				});
			}
		`;
        yield* writeTextFile(joinPath(extensionsDir, "with-flag.ts"), extCode);

        const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(1);
        expect(result.extensions[0]?.flags.has("my-flag")).toBe(true);
      }),
    ));

  it("loadExtensions only loads explicit paths without discovery", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(
          joinPath(extensionsDir, "discovered.ts"),
          extensionCodeWithTool("discovered"),
        );

        const explicitPath = joinPath(tempDir, "explicit.ts");
        yield* writeTextFile(explicitPath, extensionCodeWithTool("explicit"));

        const { loadExtensions } = yield* awaited(import("../src/core/extensions/loader.ts"));
        const result = yield* awaited(loadExtensions([explicitPath], tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(1);
        expect(result.extensions[0]?.tools.has("explicit")).toBe(true);
        expect(result.extensions[0]?.tools.has("discovered")).toBe(false);
      }),
    ));

  it("loadExtensions with no paths loads nothing", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(joinPath(extensionsDir, "discovered.ts"), extensionCode);

        const { loadExtensions } = yield* awaited(import("../src/core/extensions/loader.ts"));
        const result = yield* awaited(loadExtensions([], tempDir));

        expect(result.errors).toHaveLength(0);
        expect(result.extensions).toHaveLength(0);
      }),
    ));
});
