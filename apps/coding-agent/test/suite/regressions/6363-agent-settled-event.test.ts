import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createHarness, getUserTexts } = harnessModule;

const { gate } = testing;

function createWaitTool(released: Promise<void>): agentTypes.AgentTool {
  return {
    description: "Wait until released",
    execute: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => released);
          return { content: [{ text: "released", type: "text" }], details: {} };
        }),
      ),
    label: "Wait",
    name: "wait",
    parameters: Type.Object({}),
  };
}

const harnesses: harnessTypes.Harness[] = [];

const emitsOneAgentSettledEventAfter = Effect.gen(function* () {
  const extensionEvents: string[] = [];
  const publicEvents: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
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
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
    }),
  );
  harnesses.push(harness);
  harness.session.subscribe((event) => {
    if (event.type === "agent_settled") {
      publicEvents.push("agent_settled");
    }
  });
  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage("recovered"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(harness.eventsOfType("agent_end").map((event) => event.willRetry)).toEqual([true, false]);
  expect(harness.eventsOfType("agent_settled")).toEqual([
    { aborted: false, type: "agent_settled" },
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

const extensionCommandWaitforidleWaitsForSessionPart1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const released = gate();
    const commandStarted = gate();
    const commandResults: boolean[] = [];
    const harness = yield* Effect.promise(() =>
      createHarness({
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
        tools: [createWaitTool(released)],
      }),
    );
    return { commandResults, commandStarted, harness, released, runPromise };
  });

const extensionCommandWaitforidleWaitsForSession = Effect.gen(function* () {
  const { commandResults, commandStarted, harness, released, runPromise } =
    yield* extensionCommandWaitforidleWaitsForSessionPart1();
  harnesses.push(harness);
  yield* Effect.promise(() =>
    harness.session.bindExtensions({
      commandContextActions: {
        fork: () => Promise.resolve({ cancelled: false }),
        navigateTree: () => Promise.resolve({ cancelled: false }),
        newSession: () => Promise.resolve({ cancelled: false }),
        reload: () => runPromise(Effect.sync(() => {})),
        switchSession: () => Promise.resolve({ cancelled: false }),
        waitForIdle: () => harness.session.waitForIdle(),
      },
    }),
  );
  const toolStarted = gate();
  {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "tool_execution_start" && event.toolName === "wait") {
        unsubscribe();
        toolStarted.release();
      }
    });
  }
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

const emitsOneAgentSettledEventAfterAutomatic = () =>
  Effect.runPromise(emitsOneAgentSettledEventAfter);

const settlesOnlyAfterFollowUpsQueuedBy = () => Effect.runPromise(settlesOnlyAfterFollowUpsQueued);

const extensionCommandWaitforidleWaitsForSessionLevel = () =>
  Effect.runPromise(extensionCommandWaitforidleWaitsForSession);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("regression #6363: agent settled event and idle waiting", () => {
  afterEach(afterEachHook);
  it(
    "emits one agent_settled event after automatic retry finishes",
    emitsOneAgentSettledEventAfterAutomatic,
  );
  it(
    "settles only after follow-ups queued by agent_end handlers run",
    settlesOnlyAfterFollowUpsQueuedBy,
  );
  it(
    "extension command waitForIdle waits for session-level settlement",
    extensionCommandWaitforidleWaitsForSessionLevel,
  );
});
