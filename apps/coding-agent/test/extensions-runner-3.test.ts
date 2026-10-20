import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import ExtensionRunner from "../src/core/extensions/extension-runner.ts";
import loader from "../src/core/extensions/loader.ts";
import type modelRegistryTypes from "../src/core/model-registry.types.ts";
import SessionManager from "../src/core/session-manager.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
const { discoverAndLoadExtensions, loadExtensions } = loader;
const { createInMemoryModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, writeTextFile } =
  testing;

let tempDir: string;

let extensionsDir: string;

let sessionManager: sessionManagerTypes.SessionManager;

let modelRegistry: modelRegistryTypes.ModelRegistry;

const collectsToolsFromMultipleExtensions = () =>
  runTest(
    Effect.gen(function* () {
      const toolCode = (name: string) => `
				import { Type } from "typebox";
				export default function(msa) {
					msa.registerTool({
						name: "${name}",
						label: "${name}",
						description: "Test tool",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					});
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "tool-a.ts"), toolCode("tool_a"));
      yield* writeTextFile(joinPath(extensionsDir, "tool-b.ts"), toolCode("tool_b"));

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );
      const tools = runner.getAllRegisteredTools();

      expect(tools.length).toBe(2);
      expect(tools.map((t) => t.definition.name).sort()).toEqual(["tool_a", "tool_b"]);
    }),
  );

const rejectsExtensionToolsWithoutAParameterSchema = () =>
  runTest(
    Effect.gen(function* () {
      const extensionPath = joinPath(extensionsDir, "missing-parameters.js");
      yield* writeTextFile(
        extensionPath,
        `export default function(msa) {
	msa.registerTool({
		name: "noop",
		label: "No-op",
		description: "Do nothing",
		execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
	});
}`,
      );

      const result = yield* awaited(loadExtensions([extensionPath], tempDir));

      expect(result.extensions).toHaveLength(0);
      expect(result.errors).toEqual([
        {
          error: `Failed to load extension: Tool "noop" registered by extension "${extensionPath}" must define an object parameter schema.`,
          path: extensionPath,
        },
      ]);
    }),
  );

const keepsFirstToolWhenTwoExtensionsRegister = () =>
  runTest(
    Effect.gen(function* () {
      const first = `
				import { Type } from "typebox";
				export default function(msa) {
					msa.registerTool({
						name: "shared",
						label: "shared",
						description: "first",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					});
				}
			`;
      const second = `
				import { Type } from "typebox";
				export default function(msa) {
					msa.registerTool({
						name: "shared",
						label: "shared",
						description: "second",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					});
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "a-first.ts"), first);
      yield* writeTextFile(joinPath(extensionsDir, "b-second.ts"), second);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );
      const tools = runner.getAllRegisteredTools();

      expect(tools).toHaveLength(1);
      expect(tools[0]?.definition.description).toBe("first");
    }),
  );

const collectsCommandsFromMultipleExtensions = () =>
  runTest(
    Effect.gen(function* () {
      const cmdCode = (name: string) => `
				export default function(msa) {
					msa.registerCommand("${name}", {
						description: "Test command",
						handler: async () => {},
					});
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "cmd-a.ts"), cmdCode("cmd-a"));
      yield* writeTextFile(joinPath(extensionsDir, "cmd-b.ts"), cmdCode("cmd-b"));

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );
      const commands = runner.getRegisteredCommands();

      expect(commands.length).toBe(2);
      expect(commands.map((c) => c.name).sort()).toEqual(["cmd-a", "cmd-b"]);
      expect(commands.map((c) => c.invocationName).sort()).toEqual(["cmd-a", "cmd-b"]);
    }),
  );

const getsCommandByInvocationName = () =>
  runTest(
    Effect.gen(function* () {
      const cmdCode = `
				export default function(msa) {
					msa.registerCommand("my-cmd", {
						description: "My command",
						handler: async () => {},
					});
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "cmd.ts"), cmdCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );

      const cmd = runner.getCommand("my-cmd");
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe("my-cmd");
      expect(cmd?.invocationName).toBe("my-cmd");
      expect(cmd?.description).toBe("My command");

      const missing = runner.getCommand("not-exists");
      expect(missing).toBeUndefined();
    }),
  );

const suffixesDuplicateExtensionCommandsInInsertionOrder = () =>
  runTest(
    Effect.gen(function* () {
      const cmdCode = (description: string) => `
				export default function(msa) {
					msa.registerCommand("shared-cmd", {
						description: "${description}",
						handler: async () => {},
					});
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "cmd-a.ts"), cmdCode("First command"));
      yield* writeTextFile(joinPath(extensionsDir, "cmd-b.ts"), cmdCode("Second command"));

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );
      const commands = runner.getRegisteredCommands();
      const diagnostics = runner.getCommandDiagnostics();

      expect(commands).toHaveLength(2);
      expect(commands.map((command) => command.name)).toEqual(["shared-cmd", "shared-cmd"]);
      expect(commands.map((command) => command.invocationName)).toEqual([
        "shared-cmd:1",
        "shared-cmd:2",
      ]);
      expect(commands.map((command) => command.description)).toEqual([
        "First command",
        "Second command",
      ]);
      expect(diagnostics).toEqual([]);
      expect(runner.getCommand("shared-cmd:1")?.description).toBe("First command");
      expect(runner.getCommand("shared-cmd:2")?.description).toBe("Second command");
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

  describe("tool collection", () => {
    it("collects tools from multiple extensions", collectsToolsFromMultipleExtensions);

    it(
      "rejects extension tools without a parameter schema",
      rejectsExtensionToolsWithoutAParameterSchema,
    );

    it(
      "keeps first tool when two extensions register the same name",
      keepsFirstToolWhenTwoExtensionsRegister,
    );
  });

  describe("command collection", () => {
    it("collects commands from multiple extensions", collectsCommandsFromMultipleExtensions);

    it("gets command by invocation name", getsCommandByInvocationName);

    it(
      "suffixes duplicate extension commands in insertion order",
      suffixesDuplicateExtensionCommandsInInsertionOrder,
    );
  });
});
