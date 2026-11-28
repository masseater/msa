import { fileURLToPath } from "node:url";

import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import loader from "../src/core/extensions/loader.ts";
import extensionsDiscoverySupport from "./extensions-discovery-support.ts";
import tempDirKit from "./temp-dir.ts";

const { discoverAndLoadExtensions } = loader;

const { awaited, dirnameOf, joinPath, resolvePath, runTest, writeTextFile } = testing;

const { discoverCleanly, extensionCodeWithTool, writeExtensionFiles } = extensionsDiscoverySupport;

const { useExtensionsDir } = tempDirKit;

const extTemp = useExtensionsDir("msa-ext-test-");

const currentDir = dirnameOf(fileURLToPath(import.meta.url));

const reportsErrorsForInvalidExtensionCode = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(
        joinPath(extTemp.extensionsDir, "invalid.ts"),
        "this is not valid typescript export",
      );

      const result = yield* awaited(discoverAndLoadExtensions([], extTemp.path, extTemp.path));

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.path).toContain("invalid.ts");
      expect(result.extensions).toHaveLength(0);
    }),
  );

const handlesExplicitlyConfiguredPaths = () =>
  runTest(
    Effect.gen(function* () {
      const customPath = joinPath(extTemp.path, "custom-location", "my-ext.ts");
      yield* writeExtensionFiles(extTemp.path, ["custom-location/my-ext.ts"]);

      const result = yield* discoverCleanly(extTemp, 1, [customPath]);
      expect(result.extensions[0]?.path).toContain("my-ext.ts");
    }),
  );

const resolvesDependenciesFromExtensionSOwnNode = () =>
  runTest(
    Effect.gen(function* () {
      const extPath = resolvePath(currentDir, "../examples/extensions/with-deps");

      const result = yield* discoverCleanly(extTemp, 1, [extPath]);
      expect(result.extensions[0]?.path).toContain("with-deps");

      expect(result.extensions[0]?.tools.has("parse_duration")).toBe(true);
    }),
  );

const registersMessageAndEntryRenderers = () =>
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
      yield* writeTextFile(joinPath(extTemp.extensionsDir, "with-renderer.ts"), extCode);

      const result = yield* discoverCleanly(extTemp, 1);
      expect(result.extensions[0]?.markdownTransformer).toBeDefined();
      expect(result.extensions[0]?.messageRenderers.has("my-custom-type")).toBe(true);
      expect(result.extensions[0]?.entryRenderers?.has("my-entry-type")).toBe(true);
    }),
  );

const reportsErrorWhenExtensionThrowsDuringInitialization = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
			export default function(msa) {
				throw new Error("Initialization failed!");
			}
		`;
      yield* writeTextFile(joinPath(extTemp.extensionsDir, "throws.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], extTemp.path, extTemp.path));

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.error).toContain("Initialization failed!");
      expect(result.extensions).toHaveLength(0);
    }),
  );

const reportsErrorWhenExtensionHasNoDefault = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
			export function notDefault(msa) {
				msa.registerCommand("test", { handler: async () => {} });
			}
		`;
      yield* writeTextFile(joinPath(extTemp.extensionsDir, "no-default.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], extTemp.path, extTemp.path));

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.error).toContain("does not export a valid factory function");
      expect(result.extensions).toHaveLength(0);
    }),
  );

const allowsMultipleExtensionsToRegisterDifferentTools = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(
        joinPath(extTemp.extensionsDir, "tool-a.ts"),
        extensionCodeWithTool("tool-a"),
      );
      yield* writeTextFile(
        joinPath(extTemp.extensionsDir, "tool-b.ts"),
        extensionCodeWithTool("tool-b"),
      );

      const result = yield* discoverCleanly(extTemp, 2);

      const allTools = new Set<string>();
      for (const ext of result.extensions) {
        for (const name of ext.tools.keys()) {
          allTools.add(name);
        }
      }
      expect(allTools.has("tool-a")).toBe(true);
      expect(allTools.has("tool-b")).toBe(true);
    }),
  );

const loadsExtensionWithEventHandlers = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
			export default function(msa) {
				msa.on("agent_start", async () => {});
				msa.on("tool_call", async (event) => undefined);
				msa.on("agent_end", async () => {});
			}
		`;
      yield* writeTextFile(joinPath(extTemp.extensionsDir, "with-handlers.ts"), extCode);

      const result = yield* discoverCleanly(extTemp, 1);
      expect(result.extensions[0]?.handlers.has("agent_start")).toBe(true);
      expect(result.extensions[0]?.handlers.has("tool_call")).toBe(true);
      expect(result.extensions[0]?.handlers.has("agent_end")).toBe(true);
    }),
  );

const loadsExtensionWithShortcuts = () =>
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
      yield* writeTextFile(joinPath(extTemp.extensionsDir, "with-shortcut.ts"), extCode);

      const result = yield* discoverCleanly(extTemp, 1);
      expect(result.extensions[0]?.shortcuts.has("ctrl+t")).toBe(true);
    }),
  );

const loadsExtensionWithFlags = () =>
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
      yield* writeTextFile(joinPath(extTemp.extensionsDir, "with-flag.ts"), extCode);

      const result = yield* discoverCleanly(extTemp, 1);
      expect(result.extensions[0]?.flags.has("my-flag")).toBe(true);
    }),
  );

describe("extensions discovery 3", () => {
  it("reports errors for invalid extension code", reportsErrorsForInvalidExtensionCode);
  it("handles explicitly configured paths", handlesExplicitlyConfiguredPaths);
  it(
    "resolves dependencies from extension's own node_modules",
    resolvesDependenciesFromExtensionSOwnNode,
  );
  it("registers message and entry renderers", registersMessageAndEntryRenderers);
  it(
    "reports error when extension throws during initialization",
    reportsErrorWhenExtensionThrowsDuringInitialization,
  );
  it("reports error when extension has no default export", reportsErrorWhenExtensionHasNoDefault);
  it(
    "allows multiple extensions to register different tools",
    allowsMultipleExtensionsToRegisterDifferentTools,
  );
  it("loads extension with event handlers", loadsExtensionWithEventHandlers);
  it("loads extension with shortcuts", loadsExtensionWithShortcuts);
  it("loads extension with flags", loadsExtensionWithFlags);
});
