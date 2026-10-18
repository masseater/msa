import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { gate } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createHarness, getUserTexts, type Harness } from "../harness.ts";

function createWaitTool(released: Promise<void>): AgentTool {
  return {
    name: "wait",
    label: "Wait",
    description: "Wait until released",
    parameters: Type.Object({}),
    execute: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => released);
          return { content: [{ type: "text", text: "released" }], details: {} };
        }),
      ),
  };
}

const harnesses: Harness[] = [];

const emitsOneAgentSettledEventAfter = Effect.gen(function* () {
  const extensionEvents: string[] = [];
  const publicEvents: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
      extensionFactories: [
        (msa) => {
          msa.on("agent_end", () => {
            extensionEvents.push("agent_end");
          });
          msa.on("agent_settled", (_event, ctx) => {
            extensionEvents.push(`agent_settled:${ctx.isIdle()}`);
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.session.subscribe((event) => {
    if (event.type === "agent_settled") {
      publicEvents.push("agent_settled");
    }
  });
  harness.setResponses([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
    fauxAssistantMessage("recovered"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(harness.eventsOfType("agent_end").map((event) => event.willRetry)).toEqual([true, false]);
  expect(harness.eventsOfType("agent_settled")).toEqual([
    { type: "agent_settled", aborted: false },
  ]);
  expect(extensionEvents).toEqual(["agent_end", "agent_end", "agent_settled:true"]);
  expect(publicEvents).toEqual(["agent_settled"]);
});

const settlesOnlyAfterFollowUpsQueued = Effect.gen(function* () {
  let queuedFollowUp = false;
  const settledIdleStates: boolean[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_end", () => {
            if (queuedFollowUp) return;
            queuedFollowUp = true;
            msa.sendUserMessage("status follow-up", { deliverAs: "followUp" });
          });
          msa.on("agent_settled", (_event, ctx) => {
            settledIdleStates.push(ctx.isIdle());
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

  yield* Effect.promise(() => harness.session.prompt("hello"));

  expect(getUserTexts(harness)).toEqual(["hello", "status follow-up"]);
  expect(harness.eventsOfType("agent_end")).toHaveLength(2);
  expect(harness.eventsOfType("agent_settled")).toHaveLength(1);
  expect(settledIdleStates).toEqual([true]);
});

const extensionCommandWaitforidleWaitsForSession = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const released = gate();
  const commandStarted = gate();
  const commandResults: boolean[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      tools: [createWaitTool(released)],
      extensionFactories: [
        (msa) => {
          msa.registerCommand("after-idle", {
            description: "Wait for idle",
            handler: (_args, ctx) =>
              runPromise(
                Effect.gen(function* () {
                  commandStarted.release();
                  yield* Effect.promise(() => ctx.waitForIdle());
                  commandResults.push(ctx.isIdle());
                }),
              ),
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  yield* Effect.promise(() =>
    harness.session.bindExtensions({
      commandContextActions: {
        waitForIdle: () => harness.session.waitForIdle(),
        newSession: () => Promise.resolve({ cancelled: false }),
        fork: () => Promise.resolve({ cancelled: false }),
        navigateTree: () => Promise.resolve({ cancelled: false }),
        switchSession: () => Promise.resolve({ cancelled: false }),
        reload: () => runPromise(Effect.sync(() => {})),
      },
    }),
  );
  const toolStarted = new Promise<void>((resolve) => {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "tool_execution_start" && event.toolName === "wait") {
        unsubscribe();
        resolve();
      }
    });
  });
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);

  const promptPromise = harness.session.prompt("start");
  yield* Effect.promise(() => toolStarted);
  const commandPromise = harness.session.prompt("/after-idle");
  yield* Effect.promise(() => commandStarted);
  let commandFinished = false;
  void commandPromise.then(() => {
    commandFinished = true;
    return undefined;
  });
  yield* Effect.sleep(0);
  expect(commandFinished).toBe(false);

  released.release();
  yield* Effect.promise(() => Promise.all([promptPromise, commandPromise]));

  expect(commandResults).toEqual([true]);
  expect(harness.eventsOfType("agent_settled")).toHaveLength(1);
});

describe("regression #6363: agent settled event and idle waiting", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("emits one agent_settled event after automatic retry finishes", () =>
    Effect.runPromise(emitsOneAgentSettledEventAfter));
  it("settles only after follow-ups queued by agent_end handlers run", () =>
    Effect.runPromise(settlesOnlyAfterFollowUpsQueued));
  it("extension command waitForIdle waits for session-level settlement", () =>
    Effect.runPromise(extensionCommandWaitforidleWaitsForSession));
});
