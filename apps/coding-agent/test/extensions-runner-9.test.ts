import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import eventBus from "../src/core/event-bus.ts";
import ExtensionRunner from "../src/core/extensions/extension-runner.ts";
import loader from "../src/core/extensions/loader.ts";
import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import extensionsRunnerEnv from "./extensions-runner-env.ts";

const { createExtensionRuntime, discoverAndLoadExtensions, loadExtensionFromFactory } = loader;
const { createEventBus } = eventBus;
const { cleanupRunnerEnv, env, prepareRunnerEnv } = extensionsRunnerEnv;

const { awaited, joinPath, runTest, writeTextFile } = testing;

function loadSubscriptionExtension(factory: extensionsTypesTypes.ExtensionFactory) {
  return runTest(
    Effect.gen(function* () {
      const runtime = createExtensionRuntime(() => ({}));
      const extension = yield* awaited(
        loadExtensionFromFactory(factory, env.tempDir, createEventBus(), runtime),
      );
      const runner = new ExtensionRunner(
        [extension],
        runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );
      return yield* awaited({ extension, runner });
    }),
  );
}

const allowsSelfRemovalWithoutSkippingNeighboringHandlers = () =>
  runTest(
    Effect.gen(function* () {
      const calls: string[] = [];
      const { runner } = yield* awaited(
        loadSubscriptionExtension((msa) => {
          const unsubscribe = msa.on("agent_end", () => {
            calls.push("A");
            unsubscribe();
          });
          msa.on("agent_end", () => {
            calls.push("B");
          });
        }),
      );

      yield* awaited(runner.emit({ messages: [], type: "agent_end" as const }));
      expect(calls).toEqual(["A", "B"]);

      yield* awaited(runner.emit({ messages: [], type: "agent_end" as const }));
      expect(calls).toEqual(["A", "B", "B"]);
    }),
  );

const removesDuplicateRegistrationsIndependentlyAndCleansUp = () =>
  runTest(
    Effect.gen(function* () {
      const calls: string[] = [];
      const unsubscribers: Array<() => void> = [];
      const { extension, runner } = yield* awaited(
        loadSubscriptionExtension((msa) => {
          const shared = () => {
            calls.push("shared");
          };
          unsubscribers.push(msa.on("agent_end", shared));
          unsubscribers.push(
            msa.on("agent_end", () => {
              calls.push("B");
            }),
          );
          unsubscribers.push(msa.on("agent_end", shared));
        }),
      );
      const [stopFirst, stopB, stopSecond] = unsubscribers;
      if (stopFirst === undefined || stopB === undefined || stopSecond === undefined) {
        throw new Error("expected three unsubscribers");
      }

      stopSecond();
      stopSecond();
      yield* awaited(runner.emit({ messages: [], type: "agent_end" as const }));
      expect(calls).toEqual(["shared", "B"]);

      stopFirst();
      yield* awaited(runner.emit({ messages: [], type: "agent_end" as const }));
      expect(calls).toEqual(["shared", "B", "B"]);

      stopB();
      expect(extension.handlers.has("agent_end")).toBe(false);
    }),
  );

const keepsRemovedPendingHandlersInTheCurrent = () =>
  runTest(
    Effect.gen(function* () {
      const calls: string[] = [];
      const { runner } = yield* awaited(
        loadSubscriptionExtension((msa) => {
          msa.on("agent_end", () => {
            calls.push("A");
            stopB();
          });
          const stopB = msa.on("agent_end", () => {
            calls.push("B");
          });
          msa.on("agent_end", () => {
            calls.push("C");
          });
        }),
      );

      yield* awaited(runner.emit({ messages: [], type: "agent_end" as const }));
      expect(calls).toEqual(["A", "B", "C"]);
      yield* awaited(runner.emit({ messages: [], type: "agent_end" as const }));
      expect(calls).toEqual(["A", "B", "C", "A", "C"]);
    }),
  );

const defersRegistrationsMadeDuringDispatchUntilThe = () =>
  runTest(
    Effect.gen(function* () {
      const calls: string[] = [];
      const { runner } = yield* awaited(
        loadSubscriptionExtension((msa) => {
          msa.on("agent_end", () => {
            calls.push("A");
            msa.on("agent_end", () => {
              calls.push("C");
            });
          });
          msa.on("agent_end", () => {
            calls.push("B");
          });
        }),
      );

      yield* awaited(runner.emit({ messages: [], type: "agent_end" as const }));
      expect(calls).toEqual(["A", "B"]);
      yield* awaited(runner.emit({ messages: [], type: "agent_end" as const }));
      expect(calls).toEqual(["A", "B", "A", "B", "C"]);
    }),
  );

const usesAFreshHandlerListForNested = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const calls: string[] = [];
      const { runner } = yield* awaited(
        loadSubscriptionExtension((msa) => {
          const stopA = msa.on("agent_end", () =>
            effectRunPromise(
              Effect.gen(function* () {
                calls.push("A");
                stopA();
                stopB();
                msa.on("agent_end", () => {
                  calls.push("C");
                });
                yield* awaited(runner.emit({ messages: [], type: "agent_end" as const }));
              }),
            ),
          );
          const stopB = msa.on("agent_end", () => {
            calls.push("B");
          });
        }),
      );

      yield* awaited(runner.emit({ messages: [], type: "agent_end" as const }));
      expect(calls).toEqual(["A", "C", "B"]);
    }),
  );

const returnsTrueWhenHandlersExistForEvent = () =>
  runTest(
    Effect.gen(function* () {
      const extCode = `
				export default function(msa) {
					msa.on("tool_call", async () => undefined);
				}
			`;
      yield* writeTextFile(joinPath(env.extensionsDir, "handler.ts"), extCode);

      const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
      const runner = new ExtensionRunner(
        result.extensions,
        result.runtime,
        env.tempDir,
        env.sessionManager,
        env.modelRegistry,
      );

      expect(runner.hasHandlers("tool_call")).toBe(true);
      expect(runner.hasHandlers("agent_end")).toBe(false);
    }),
  );

describe("ExtensionRunner", () => {
  beforeEach(() => runTest(prepareRunnerEnv));

  afterEach(cleanupRunnerEnv);

  describe("event subscriptions", () => {
    it(
      "allows self-removal without skipping neighboring handlers",
      allowsSelfRemovalWithoutSkippingNeighboringHandlers,
    );

    it(
      "removes duplicate registrations independently and cleans up the last handler",
      removesDuplicateRegistrationsIndependentlyAndCleansUp,
    );

    it(
      "keeps removed pending handlers in the current dispatch",
      keepsRemovedPendingHandlersInTheCurrent,
    );

    it(
      "defers registrations made during dispatch until the next dispatch",
      defersRegistrationsMadeDuringDispatchUntilThe,
    );

    it("uses a fresh handler list for nested dispatches", usesAFreshHandlerListForNested);
  });

  describe("hasHandlers", () => {
    it("returns true when handlers exist for event type", returnsTrueWhenHandlersExistForEvent);
  });
});
