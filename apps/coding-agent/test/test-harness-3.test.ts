import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import testHarness from "./test-harness.ts";
import type testHarnessTypes from "./test-harness.types.ts";

const { createHarness, createHarnessWithExtensions } = testHarness;

const { awaited, runTest } = testing;

let harness: testHarnessTypes.Harness;

const loadsInlineExtensionFactoriesAndDisambiguatesDuplicatePart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const calls: string[] = [];

    harness = yield* awaited(
      createHarnessWithExtensions({
        extensionFactories: [
          {
            factory: (msa) => {
              msa.registerCommand("shared-cmd", {
                description: "Alpha command",
                handler: (args) =>
                  effectRunPromise(
                    Effect.sync(() => {
                      calls.push(`alpha:${args}`);
                    }),
                  ),
              });
            },
            path: "<alpha>",
          },
          {
            factory: (msa) => {
              msa.registerCommand("shared-cmd", {
                description: "Beta command",
                handler: (args) =>
                  effectRunPromise(
                    Effect.sync(() => {
                      calls.push(`beta:${args}`);
                    }),
                  ),
              });
            },
            path: "<beta>",
          },
        ],
      }),
    );
    return { calls };
  });

const loadsInlineExtensionFactoriesAndDisambiguatesDuplicate = () =>
  runTest(
    Effect.gen(function* () {
      const { calls } = yield* loadsInlineExtensionFactoriesAndDisambiguatesDuplicatePart1();

      const runner = harness.session.extensions.binding.extensionRunner;
      expect(runner).toBeDefined();

      const commands = runner!.getRegisteredCommands();
      expect(
        commands.map((command) => ({
          description: command.description,
          invocationName: command.invocationName,
          name: command.name,
          path: command.sourceInfo.path,
        })),
      ).toEqual([
        {
          description: "Alpha command",
          invocationName: "shared-cmd:1",
          name: "shared-cmd",
          path: "<alpha>",
        },
        {
          description: "Beta command",
          invocationName: "shared-cmd:2",
          name: "shared-cmd",
          path: "<beta>",
        },
      ]);

      yield* awaited(
        runner!.getCommand("shared-cmd:1")?.handler("first", runner!.createCommandContext()),
      );
      yield* awaited(
        runner!.getCommand("shared-cmd:2")?.handler("second", runner!.createCommandContext()),
      );

      expect(calls).toEqual(["alpha:first", "beta:second"]);
    }),
  );

const sessionPersistenceWorks = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(createHarness({ responses: ["persisted"] }));

      yield* awaited(harness.session.run.prompting.prompt("hi"));

      const entries = harness.sessionManager.getEntries();
      const messageEntries = entries.filter((e) => e.type === "message");
      expect(messageEntries.length).toBeGreaterThanOrEqual(2);
    }),
  );

describe("test harness", () => {
  afterEach(() => {
    harness?.cleanup();
  });

  it(
    "loads inline extension factories and disambiguates duplicate commands",
    loadsInlineExtensionFactoriesAndDisambiguatesDuplicate,
  );

  it("session persistence works", sessionPersistenceWorks);
});
