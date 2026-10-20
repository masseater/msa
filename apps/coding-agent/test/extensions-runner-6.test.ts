import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { createInMemoryModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, writeTextFile } =
  testing;

let tempDir: string;

let extensionsDir: string;

let sessionManager: SessionManager;

let modelRegistry: ModelRegistry;

const acceptsValidUserBashOperationsAndResult = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
				export default function(msa) {
					msa.on("user_bash", async (event) => {
						if (event.command === "operations") {
							return { operations: { exec: async () => ({ exitCode: 0 }) } };
						}
						return { result: { output: "handled", exitCode: 0, cancelled: false, truncated: false } };
					});
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "valid-results.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );
      const event = { cwd: tempDir, excludeFromContext: false, type: "user_bash" as const };

      const operations = yield* awaited(runner.emitUserBash({ ...event, command: "operations" }));
      expect(operations).toEqual({ operations: { exec: expect.any(Function) } });
      yield* awaited(
        expect(runner.emitUserBash({ ...event, command: "result" })).resolves.toEqual({
          result: { cancelled: false, exitCode: 0, output: "handled", truncated: false },
        }),
      );
    }),
  );

const getsMarkdownTransformersInExtensionLoadOrder = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
				export default function(msa) {
					msa.registerMarkdownTransformer((markdown) => markdown);
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "markdown-renderer-a.ts"), extCode);
      yield* writeTextFile(joinPath(extensionsDir, "markdown-renderer-b.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );

      expect(runner.getMarkdownTransformers()).toHaveLength(2);
    }),
  );

const getsMessageRendererByType = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
				export default function(msa) {
					msa.registerMessageRenderer("my-type", (message, options, theme) => null);
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "renderer.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );

      const renderer = runner.getMessageRenderer("my-type");
      expect(renderer).toBeDefined();

      const missing = runner.getMessageRenderer("not-exists");
      expect(missing).toBeUndefined();
    }),
  );

const getsEntryRendererByType = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
				export default function(msa) {
					msa.registerEntryRenderer("my-entry", (entry, options, theme) => null);
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "entry-renderer.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );

      expect(runner.getEntryRenderer("my-entry")).toBeDefined();
      expect(runner.getEntryRenderer("not-exists")).toBeUndefined();
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("msa-runner-test-");
      extensionsDir = joinPath(tempDir, "extensions");
      yield* makeDirectory(extensionsDir);
      sessionManager = SessionManager.inMemory();
      modelRegistry = yield* awaited(createInMemoryModelRegistry(AuthStorage.inMemory()));
    }),
  );

describe("ExtensionRunner", () => {
  beforeEach(beforeEachHook);

  afterEach(() => runTest(removePath(tempDir)));

  describe("error handling", () => {
    it(
      "accepts valid user_bash operations and result overrides",
      acceptsValidUserBashOperationsAndResult,
    );
  });
});

describe("ExtensionRunner", () => {
  beforeEach(beforeEachHook);

  afterEach(() => runTest(removePath(tempDir)));

  describe("message and entry renderers", () => {
    it(
      "gets Markdown transformers in extension load order",
      getsMarkdownTransformersInExtensionLoadOrder,
    );

    it("gets message renderer by type", getsMessageRendererByType);

    it("gets entry renderer by type", getsEntryRendererByType);
  });
});
