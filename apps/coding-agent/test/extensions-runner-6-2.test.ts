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
const { discoverAndLoadExtensions } = loader;
const { createInMemoryModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, writeTextFile } =
  testing;

let tempDir: string;

let extensionsDir: string;

let sessionManager: sessionManagerTypes.SessionManager;

let modelRegistry: modelRegistryTypes.ModelRegistry;

const collectsFlagsFromExtensions = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
				export default function(msa) {
					msa.registerFlag("my-flag", {
						description: "My flag",
						handler: async () => {},
					});
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "with-flag.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );
      const flags = runner.getFlags();

      expect(flags.has("my-flag")).toBe(true);
    }),
  );

const keepsFirstFlagWhenTwoExtensionsRegister = () =>
  runTest(
    Effect.gen(function* () {
      const first = `
				export default function(msa) {
					msa.registerFlag("shared-flag", {
						description: "first",
						type: "boolean",
						default: true,
					});
				}
			`;
      const second = `
				export default function(msa) {
					msa.registerFlag("shared-flag", {
						description: "second",
						type: "boolean",
						default: false,
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
      const flags = runner.getFlags();

      expect(flags.get("shared-flag")?.description).toBe("first");
      expect(result.runtime.flagValues.get("shared-flag")).toBe(true);
    }),
  );

const rejectsDefaultValuesThatDoNotMatch = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
				export default function(msa) {
					msa.registerFlag("safe-mode", {
						type: "boolean",
						default: "false",
					});
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "bad-flag-default.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));

      expect(result.extensions).toHaveLength(0);
      expect(result.errors[0]?.error).toContain(
        'Invalid default for flag "safe-mode": expected boolean, got string',
      );
      expect(result.runtime.flagValues.has("safe-mode")).toBe(false);
    }),
  );

const canSetFlagValues = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
				export default function(msa) {
					msa.registerFlag("test-flag", {
						description: "Test flag",
						handler: async () => {},
					});
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "flag.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );

      runner.setFlagValue("--test-flag", true);

      expect(result.runtime.flagValues.get("--test-flag")).toBe(true);
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

  describe("flags", () => {
    it("collects flags from extensions", collectsFlagsFromExtensions);

    it(
      "keeps first flag when two extensions register the same name",
      keepsFirstFlagWhenTwoExtensionsRegister,
    );

    it(
      "rejects default values that do not match the flag type",
      rejectsDefaultValuesThatDoNotMatch,
    );

    it("can set flag values", canSetFlagValues);
  });
});
