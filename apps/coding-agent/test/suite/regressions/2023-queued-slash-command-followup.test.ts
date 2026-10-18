import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import type { ExtensionAPI } from "@msa/coding-agent";
import { gate } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createHarness, getAssistantTexts, getUserTexts, type Harness } from "../harness.ts";

const harnesses: Harness[] = [];

const treatsExtensionOriginQueuedSlashCommand = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let extensionApi: ExtensionAPI | undefined;
  const commandRuns: string[] = [];
  const toolRelease = gate();
  const waitTool: AgentTool = {
    name: "wait",
    label: "Wait",
    description: "Wait for the test to release execution",
    parameters: Type.Object({}),
    execute: () =>
      runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => toolRelease);
          return {
            content: [{ type: "text", text: "released" }],
            details: {},
          };
        }),
      ),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      tools: [waitTool],
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
    }),
  );
  harnesses.push(harness);

  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("first turn complete"),
    fauxAssistantMessage("queued follow-up handled by model"),
  ]);

  const sawToolStart = new Promise<void>((resolve) => {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "tool_execution_start" && event.toolName === "wait") {
        unsubscribe();
        resolve();
      }
    });
  });

  const promptPromise = harness.session.prompt("start");
  yield* Effect.promise(() => sawToolStart);
  yield* Effect.sleep(0);

  extensionApi?.sendUserMessage("/testcmd queued", { deliverAs: "followUp" });
  toolRelease.release();
  yield* Effect.promise(() => promptPromise);

  expect(commandRuns).toEqual([]);
  expect(getUserTexts(harness)).toEqual(["start", "/testcmd queued"]);
  expect(getAssistantTexts(harness)).toContain("queued follow-up handled by model");
});

describe("issue #2023 queued slash-command follow-up", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("treats extension-origin queued slash-command follow-ups as raw user text instead of dispatching the command", () =>
    Effect.runPromise(treatsExtensionOriginQueuedSlashCommand));
});
