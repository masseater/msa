import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import {
  defineTool,
  type Harness,
  LiveDoc,
  type LiveState,
  MemoryStorage,
  type ToolExecutionApi,
  type ToolRegistration,
} from "@msa/durable";

import { chatSetup, openChat, waitFor } from "./chat-support.ts";
import { addTool } from "./harness-support.ts";
import { context, documentChanges } from "./session-support.ts";

export type Action = (api: ToolExecutionApi) => void | Promise<void>;

// The tool `drive` runs: each queued action in turn, waiting for more until one returns false.
export function drivenTool(
  outputLimits: NonNullable<ToolRegistration["outputLimits"]>,
  actions: ((api: ToolExecutionApi) => Promise<boolean>)[],
  waker: { wake?: () => void },
) {
  return defineTool({
    name: "drive",
    description: "Driven by the test",
    parameters: Type.Object({}),
    outputLimits,
    execute: (_args, api, callContext) => {
      const next = async (): Promise<Record<string, never>> => {
        const action = actions.shift();
        if (action === undefined) {
          await new Promise<void>((resolve, reject) => {
            waker.wake = resolve;
            const signal = callContext.abortSignal!;
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        } else if (!(await action(api))) {
          return {};
        }
        return next();
      };
      return next();
    },
  });
}

// Drive one tool call step by step and capture the exact Chord operations of every `msa.live` commit. Each `step()`
// runs one action inside the tool and returns the operations of the commit it caused.
export async function drive(outputLimits: NonNullable<ToolRegistration["outputLimits"]> = {}) {
  const setup = chatSetup();
  const actions: ((api: ToolExecutionApi) => Promise<boolean>)[] = [];
  const waker: { wake?: () => void } = {};
  addTool(setup.registry, drivenTool(outputLimits, actions, waker));
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("drive", {}, { id: "c1" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = await openChat(new MemoryStorage(), setup);
  const commits: Op[][] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      if (change.record.kind === "msa.live" && change.ops.length > 0) commits.push([...change.ops]);
    }
  });
  const submission = await root.submit({ type: "input", content: "go" }, context);
  await waitFor(async () => (await live(harness))?.tools?.[0]?.status === "running");
  const push = (action: (api: ToolExecutionApi) => Promise<boolean>): void => {
    actions.push(action);
    waker.wake?.();
  };
  return {
    harness,
    commits,
    // Operations of every `msa.live` commit so far.
    async step(action: Action): Promise<readonly Op[]> {
      const before = commits.length;
      push(async (api) => {
        await action(api);
        return true;
      });
      await waitFor(() => commits.length > before);
      return commits.at(-1)!;
    },
    // Let the tool return and the run finish; returns the commits made meanwhile.
    async finish(): Promise<readonly Op[][]> {
      const before = commits.length;
      push(() => Promise.resolve(false));
      await submission.wait(context);
      return commits.slice(before);
    },
  };
}

export function live(harness: Harness): Promise<Readonly<LiveState> | undefined> {
  return harness.snapshot(LiveDoc, 1 as never, context);
}

export const OUTPUT = ["tools", 0, "output"];
