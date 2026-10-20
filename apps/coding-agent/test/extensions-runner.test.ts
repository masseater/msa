import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { discoverAndLoadExtensions, loadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner, emitProjectTrustEvent } from "../src/core/extensions/runner.ts";
import type { ScopedModel } from "../src/core/model-resolver.ts";
import extensionsRunnerEnv from "./extensions-runner-env.ts";
import extensionsRunnerSupport from "./extensions-runner-support.ts";

const { cleanupRunnerEnv, env, prepareRunnerEnv } = extensionsRunnerEnv;

const { extensionActions, extensionContextActions } = extensionsRunnerSupport;

const { awaited, joinPath, runTest, writeTextFile } = testing;

const reflectsTheGetscopedmodelsContextActionOnCtx = () =>
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

      expect(runner.createContext().scopedModels).toEqual([]);

      const scoped = [
        { model: { id: "scoped-test" }, thinkingLevel: "high" },
      ] as unknown as ScopedModel[];
      runner.bindCore(extensionActions, {
        ...extensionContextActions,
        getScopedModels: () => scoped,
      });
      expect(runner.createContext().scopedModels).toBe(scoped);
    }),
  );

const continuesPastUndecidedHandlersAndReturnsThe = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const undecidedPath = joinPath(env.extensionsDir, "undecided.ts");
      const decidedPath = joinPath(env.extensionsDir, "decided.ts");
      yield* writeTextFile(
        undecidedPath,
        `export default function(msa) {
	msa.on("project_trust", () => ({ trusted: "undecided", remember: true }));
}`,
      );
      yield* writeTextFile(
        decidedPath,
        `export default function(msa) {
	msa.on("project_trust", () => ({ trusted: "no", remember: true }));
}`,
      );

      const extensionsResult = yield* awaited(
        loadExtensions([undecidedPath, decidedPath], env.tempDir),
      );
      const result = yield* awaited(
        emitProjectTrustEvent(
          extensionsResult,
          { cwd: env.tempDir, type: "project_trust" as const },
          {
            cwd: env.tempDir,
            hasUI: false,
            mode: "tui",
            ui: {
              confirm: () => effectRunPromise(awaited(false)),
              input: () => effectRunPromise(awaited(undefined)),
              notify: () => {},
              select: () => effectRunPromise(awaited(undefined)),
            },
          },
        ),
      );

      expect(result.result).toEqual({ remember: true, trusted: "no" });
      expect(result.errors).toEqual([]);
    }),
  );

describe("ExtensionRunner", () => {
  beforeEach(() => runTest(prepareRunnerEnv));

  afterEach(cleanupRunnerEnv);

  describe("scopedModels", () => {
    it(
      "reflects the getScopedModels context action on ctx.scopedModels",
      reflectsTheGetscopedmodelsContextActionOnCtx,
    );
  });

  describe("project_trust", () => {
    it(
      "continues past undecided handlers and returns the first yes/no decision",
      continuesPastUndecidedHandlersAndReturnsThe,
    );
  });
});
