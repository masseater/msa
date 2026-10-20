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

const letsAHandlerMutateHeadersInPlace = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
				export default function(msa) {
					msa.on("before_provider_headers", (event) => {
						event.headers["X-Turn-Index"] = "3";
					});
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "headers.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );

      expect(runner.hasHandlers("before_provider_headers")).toBe(true);

      const headers = yield* awaited(
        runner.emitBeforeProviderHeaders({ "User-Agent": "kimchi/1.0" }),
      );
      expect(headers["X-Turn-Index"]).toBe("3");
      expect(headers["User-Agent"]).toBe("kimchi/1.0");
    }),
  );

const isolatesAThrowingHandlerAndStillApplies = () =>
  runTest(
    Effect.gen(function* () {
      const throwing = `
				export default function(msa) {
					msa.on("before_provider_headers", () => {
						throw new Error("header handler boom");
					});
				}
			`;
      const good = `
				export default function(msa) {
					msa.on("before_provider_headers", (event) => {
						event.headers["X-Good"] = "yes";
					});
				}
			`;
      yield* writeTextFile(joinPath(extensionsDir, "a-throwing.ts"), throwing);
      yield* writeTextFile(joinPath(extensionsDir, "b-good.ts"), good);

      const result = yield* awaited(discoverAndLoadExtensions([], tempDir, tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        tempDir,
        sessionManager,
        modelRegistry,
      );
      const errors: Array<{ event: string; error: string }> = [];
      runner.onError((err) => errors.push(err));

      const headers = yield* awaited(runner.emitBeforeProviderHeaders({ "User-Agent": "x" }));

      expect(headers["X-Good"]).toBe("yes");
      expect(headers["User-Agent"]).toBe("x");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.event).toBe("before_provider_headers");
      expect(errors[0]?.error).toContain("header handler boom");
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

  describe("before_provider_headers", () => {
    it(
      "lets a handler mutate headers in place and preserves existing headers",
      letsAHandlerMutateHeadersInPlace,
    );

    it(
      "isolates a throwing handler and still applies the others",
      isolatesAThrowingHandlerAndStillApplies,
    );
  });
});
