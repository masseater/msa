import type agentTypes from "@msa/agent-core/index.types";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";

import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { createHarness } = harnessModule;

const { gate } = testing;

const makeWaitTool = (toolRelease: ReturnType<typeof gate>): agentTypes.AgentTool => ({
  description: "Wait for the test to release execution",
  execute: () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() => toolRelease);
        return { content: [{ text: "released", type: "text" }], details: {} };
      }),
    ),
  label: "Wait",
  name: "wait",
  parameters: Type.Object({}),
});

const toolStarted = (harness: harnessTypes.Harness, toolName: string) => {
  const started = gate();
  const unsubscribe = harness.session.subscribe((event) => {
    if (event.type === "tool_execution_start" && event.toolName === toolName) {
      unsubscribe();
      started.release();
    }
  });
  return started;
};

function createWaitingHarness(
  options: {
    tools?: agentTypes.AgentTool[];
    extensionFactories?: harnessTypes.Harness["session"]["extensionRunner"] extends never
      ? never
      : Array<(msa: codingAgentTypes.ExtensionAPI) => void>;
  } = {},
): Promise<{
  harness: harnessTypes.Harness;
  releaseToolExecution: () => void;
  promptPromise: Promise<void>;
  waitForToolStart: Promise<void>;
}> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const toolRelease = gate();
      const harness = yield* Effect.promise(() =>
        createHarness({
          tools: [makeWaitTool(toolRelease), ...(options.tools ?? [])],
          ...(options.extensionFactories === undefined
            ? {}
            : { extensionFactories: options.extensionFactories }),
        }),
      );
      const waitForToolStart = toolStarted(harness, "wait");
      return {
        harness,
        promptPromise: harness.session.prompt("start"),
        releaseToolExecution: () => toolRelease.release(),
        waitForToolStart,
      };
    }),
  );
}
const harnesses: harnessTypes.Harness[] = [];

const agentSessionQueueCases1 = {
  createWaitingHarness,
  harnesses,
  makeWaitTool,
  toolStarted,
};

export default agentSessionQueueCases1;
