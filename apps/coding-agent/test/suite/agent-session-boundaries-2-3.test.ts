import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionBoundariesSupport from "./agent-session-boundaries-support.ts";
import harnessModule from "./harness.ts";

const { cleanupAll } = harnessModule;

const { fauxAssistantMessage } = ai;

const { harnesses } = agentSessionBoundariesSupport;

const { createHarness } = harnessModule;

const defersRunsStartedByAgentSettled = Effect.gen(function* () {
  let triggered = false;
  const lifecycle: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_start", () => {
            lifecycle.push("start");
          });
          msa.on("agent_settled", (_event, ctx) => {
            lifecycle.push(`settled-first:${ctx.isIdle()}`);
            if (triggered) return;
            triggered = true;
            msa.sendMessage(
              { content: "start later", customType: "settled-trigger", display: false },
              { triggerTurn: true },
            );
          });
          msa.on("agent_settled", (_event, ctx) => {
            lifecycle.push(`settled-second:${ctx.isIdle()}`);
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));

  expect(lifecycle).toEqual([
    "start",
    "settled-first:true",
    "settled-second:true",
    "start",
    "settled-first:true",
    "settled-second:true",
  ]);
});

const defersRunsStartedByAgentSettledHandlers = () =>
  Effect.runPromise(defersRunsStartedByAgentSettled);

describe("AgentSession actionable boundaries", () => {
  afterEach(() => cleanupAll(harnesses));

  it(
    "defers runs started by agent_settled handlers until every settled handler completes",
    defersRunsStartedByAgentSettledHandlers,
  );
});
