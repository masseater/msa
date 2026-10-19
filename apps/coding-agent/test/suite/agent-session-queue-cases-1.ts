import type { AgentTool } from "@msa/agent-core";
import type { ExtensionAPI } from "@msa/coding-agent";
import { gate } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { createHarness, type Harness } from "./harness.ts";

export function createWaitingHarness(
  options: {
    tools?: AgentTool[];
    extensionFactories?: Harness["session"]["extensionRunner"] extends never
      ? never
      : Array<(msa: ExtensionAPI) => void>;
  } = {},
): Promise<{
  harness: Harness;
  releaseToolExecution: () => void;
  promptPromise: Promise<void>;
  waitForToolStart: Promise<void>;
}> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const toolRelease = gate();
      const waitTool: AgentTool = {
        name: "wait",
        label: "Wait",
        description: "Wait for release",
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
          tools: [waitTool, ...(options.tools ?? [])],
          ...(options.extensionFactories === undefined
            ? {}
            : { extensionFactories: options.extensionFactories }),
        }),
      );

      const waitForToolStart = gate();
      {
        const unsubscribe = harness.session.subscribe((event) => {
          if (event.type === "tool_execution_start" && event.toolName === "wait") {
            unsubscribe();
            waitForToolStart.release();
          }
        });
      }

      return {
        harness,
        releaseToolExecution: () => toolRelease.release(),
        promptPromise: harness.session.prompt("start"),
        waitForToolStart,
      };
    }),
  );
}
export const harnesses: Harness[] = [];
