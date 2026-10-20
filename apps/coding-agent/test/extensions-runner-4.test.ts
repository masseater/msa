import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { ExtensionUIContext } from "../src/core/extensions/types.ts";
import extensionsRunnerEnv from "./extensions-runner-env.ts";
import extensionsRunnerSupport from "./extensions-runner-support.ts";

const { cleanupRunnerEnv, env, prepareRunnerEnv } = extensionsRunnerEnv;

const { extensionActions, extensionContextActions } = extensionsRunnerSupport;

const { abortController, awaited, joinPath, runTest, writeTextFile } = testing;

const exposesTheCurrentAbortSignalOnExtensioncontext = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );
      const controller = abortController();

      runner.bindCore(extensionActions, {
        ...extensionContextActions,
        getSignal: () => controller.signal,
      });

      const ctx = runner.createContext();
      expect(ctx.signal).toBe(controller.signal);
      expect(ctx.signal?.aborted).toBe(false);

      controller.abort();
      expect(ctx.signal?.aborted).toBe(true);
    }),
  );

const exposesPrintModeAndHasuiFalseBy = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );
      runner.bindCore(extensionActions, extensionContextActions);

      const ctx = runner.createContext();
      expect(ctx.mode).toBe("print");
      expect(ctx.hasUI).toBe(false);
    }),
  );

const exposesProjectTrustStateOnExtensioncontext = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );
      runner.bindCore(extensionActions, {
        ...extensionContextActions,
        isProjectTrusted: () => false,
      });

      const ctx = runner.createContext();
      expect(ctx.isProjectTrusted()).toBe(false);
    }),
  );

const exposesRpcModeWithHasuiTrueWhen = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );
      runner.bindCore(extensionActions, extensionContextActions);
      runner.setUIContext({} as ExtensionUIContext, "rpc");

      const ctx = runner.createContext();
      expect(ctx.mode).toBe("rpc");
      expect(ctx.hasUI).toBe(true);
    }),
  );

const exposesTuiModeWithHasuiTrueWhen = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );
      runner.bindCore(extensionActions, extensionContextActions);
      runner.setUIContext({} as ExtensionUIContext, "tui");

      const ctx = runner.createContext();
      expect(ctx.mode).toBe("tui");
      expect(ctx.hasUI).toBe(true);
    }),
  );

const callsErrorListenersWhenHandlerThrows = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
				export default function(msa) {
					msa.on("context", async () => {
						throw new Error("Handler error!");
					});
				}
			`;
      yield* writeTextFile(joinPath(env.extensionsDir, "throws.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );

      const errors: Array<{ extensionPath: string; event: string; error: string }> = [];
      runner.onError((err) => {
        errors.push(err);
      });

      yield* awaited(runner.emitContext([]));

      expect(errors.length).toBe(1);
      expect(errors[0]?.error).toContain("Handler error!");
      expect(errors[0]?.event).toBe("context");
    }),
  );

const failsClosedWhenAUserBashHandler = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
				export default function(msa) {
					msa.on("user_bash", async () => {
						throw new Error("Routing failed");
					});
				}
			`;
      yield* writeTextFile(joinPath(env.extensionsDir, "throws.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );
      const errors: Array<{ event: string; error: string }> = [];
      runner.onError((error) => errors.push(error));

      yield* awaited(
        expect(
          runner.emitUserBash({
            command: "pwd",
            cwd: env.tempDir,
            excludeFromContext: false,
            type: "user_bash" as const,
          }),
        ).rejects.toThrow("Routing failed"),
      );
      expect(errors).toMatchObject([{ error: "Routing failed", event: "user_bash" }]);
    }),
  );

describe("ExtensionRunner", () => {
  beforeEach(() => runTest(prepareRunnerEnv));

  afterEach(cleanupRunnerEnv);

  describe("context creation", () => {
    it(
      "exposes the current abort signal on ExtensionContext",
      exposesTheCurrentAbortSignalOnExtensioncontext,
    );

    it("exposes print mode and hasUI false by default", exposesPrintModeAndHasuiFalseBy);

    it(
      "exposes project trust state on ExtensionContext",
      exposesProjectTrustStateOnExtensioncontext,
    );

    it(
      "exposes rpc mode with hasUI true when an RPC UI context is provided",
      exposesRpcModeWithHasuiTrueWhen,
    );

    it(
      "exposes tui mode with hasUI true when a TUI UI context is provided",
      exposesTuiModeWithHasuiTrueWhen,
    );
  });

  describe("error handling", () => {
    it("calls error listeners when handler throws", callsErrorListenersWhenHandlerThrows);

    it("fails closed when a user_bash handler throws", failsClosedWhenAUserBashHandler);
  });
});
