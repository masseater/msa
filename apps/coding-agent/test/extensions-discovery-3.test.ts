import { fileURLToPath } from "node:url";

import {
  awaited,
  dirnameOf,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  resolvePath,
  runTest,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";

const currentDir = dirnameOf(fileURLToPath(import.meta.url));

describe("extensions discovery 3", () => {
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
        const extPath = resolvePath(currentDir, "../examples/extensions/with-deps");

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
});
