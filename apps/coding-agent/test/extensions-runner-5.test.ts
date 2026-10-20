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

const beforeEachHook = Effect.gen(function* () {
  tempDir = yield* makeTempDir("msa-runner-test-");
  extensionsDir = joinPath(tempDir, "extensions");
  yield* makeDirectory(extensionsDir);
  sessionManager = SessionManager.inMemory();
  modelRegistry = yield* awaited(createInMemoryModelRegistry(AuthStorage.inMemory()));
});

const failsClosedForUserBashResult = (handlerResult: string) =>
  Effect.gen(function* () {
    const extCode = `
				export default function(msa) {
					msa.on("user_bash", async () => (${handlerResult}));
				}
			`;
    yield* writeTextFile(joinPath(extensionsDir, "invalid-result.ts"), extCode);

    const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
    const runner = new ExtensionRunner(
      result.extensions,
      result.runtime,
      tempDir,
      sessionManager,
      modelRegistry,
    );
    const errors: Array<{ event: string; error: string }> = [];
    runner.onError((error) => errors.push(error));

    yield* awaited(
      expect(
        runner.emitUserBash({
          command: "pwd",
          cwd: tempDir,
          excludeFromContext: false,
          type: "user_bash" as const,
        }),
      ).rejects.toThrow("Invalid user_bash handler result"),
    );
    expect(errors).toMatchObject([
      { error: expect.stringContaining("Invalid user_bash handler result"), event: "user_bash" },
    ]);
  });

describe("ExtensionRunner", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(() => runTest(removePath(tempDir)));

  describe("error handling", () => {
    it.each([
      ["an empty object", "{}"],
      ["null operations", "{ operations: null }"],
      ["operations without exec", "{ operations: {} }"],
      ["a null result", "{ result: null }"],
      ["an incomplete result", '{ result: { output: "handled" } }'],
      [
        "operations and a result",
        '{ operations: { exec: async () => ({ exitCode: 0 }) }, result: { output: "handled", exitCode: 0, cancelled: false, truncated: false } }',
      ],
    ])("fails closed when a user_bash handler returns %s", (_description, handlerResult) =>
      runTest(failsClosedForUserBashResult(handlerResult)),
    );
  });
});
