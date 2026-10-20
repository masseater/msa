import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import type { ExtensionAPI } from "@msa/coding-agent";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionQueueCases1 from "../agent-session-queue-cases-1.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness, getAssistantTexts, getUserTexts } = harnessModule;

const { makeWaitTool, toolStarted } = agentSessionQueueCases1;

const { gate } = testing;

const harnesses: harnessTypes.Harness[] = [];

const treatsExtensionOriginQueuedSlashCommandStep1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    let extensionApi: ExtensionAPI | undefined;
    const commandRuns: string[] = [];
    const toolRelease = gate();
    const waitTool = makeWaitTool(toolRelease);
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            extensionApi = msa;
            msa.registerCommand("testcmd", {
              description: "Test command",
              handler: (args) =>
                runPromise(
                  Effect.sync(() => {
                    commandRuns.push(args);
                  }),
                ),
            });
          },
        ],
        tools: [waitTool],
      }),
    );
    harnesses.push(harness);

    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("first turn complete"),
      fauxAssistantMessage("queued follow-up handled by model"),
    ]);

    const sawToolStart = toolStarted(harness, "wait");
    const promptPromise = harness.session.prompt("start");
    yield* Effect.promise(() => sawToolStart);
    yield* Effect.sleep(0);

    extensionApi?.sendUserMessage("/testcmd queued", { deliverAs: "followUp" });
    return { commandRuns, harness, promptPromise, toolRelease };
  });

const treatsExtensionOriginQueuedSlashCommand = Effect.gen(function* () {
  const { commandRuns, harness, promptPromise, toolRelease } =
    yield* treatsExtensionOriginQueuedSlashCommandStep1();
  toolRelease.release();
  yield* Effect.promise(() => promptPromise);

  expect(commandRuns).toEqual([]);
  expect(getUserTexts(harness)).toEqual(["start", "/testcmd queued"]);
  expect(getAssistantTexts(harness)).toContain("queued follow-up handled by model");
});

const treatsExtensionOriginQueuedSlashCommandFollow = () =>
  Effect.runPromise(treatsExtensionOriginQueuedSlashCommand);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("issue #2023 queued slash-command follow-up", () => {
  afterEach(afterEachHook);
  it(
    "treats extension-origin queued slash-command follow-ups as raw user text instead of dispatching the command",
    treatsExtensionOriginQueuedSlashCommandFollow,
  );
});
