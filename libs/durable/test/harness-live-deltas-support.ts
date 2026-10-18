import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import {
  defineTool,
  type Harness,
  LiveDoc,
  type LiveState,
  type ToolExecutionApi,
  type ToolRegistration,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";

import { chatSetup, openChat, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addTool } from "./harness-support.ts";
import { context, documentChanges } from "./session-support.ts";

export type Action = (api: ToolExecutionApi) => void | Promise<void>;

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
      const next = (): Promise<Record<string, never>> =>
        Effect.runPromise(
          Effect.gen(function* () {
            const action = actions.shift();
            if (action === undefined) {
              yield* awaited(
                new Promise<void>((resolve, reject) => {
                  waker.wake = resolve;
                  const signal = callContext.abortSignal!;
                  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                }),
              );
            } else if (!(yield* awaited(action(api)))) {
              return {};
            }
            return yield* awaited(next());
          }),
        );
      return next();
    },
  });
}

export const drive = Effect.fn("drive")(function* (
  outputLimits: NonNullable<ToolRegistration["outputLimits"]> = {},
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const actions: ((api: ToolExecutionApi) => Promise<boolean>)[] = [];
  const waker: { wake?: () => void } = {};
  addTool(setup.registry, drivenTool(outputLimits, actions, waker));
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("drive", {}, { id: "c1" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const commits: Op[][] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      if (change.record.kind === "msa.live" && change.ops.length > 0) commits.push([...change.ops]);
    }
  });
  const submission = yield* awaited(root.submit({ type: "input", content: "go" }, context));
  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(live(harness)))?.tools?.[0]?.status === "running";
      }),
    ),
  );
  const push = (action: (api: ToolExecutionApi) => Promise<boolean>): void => {
    actions.push(action);
    waker.wake?.();
  };
  return {
    harness,
    commits,
    step(action: Action): Promise<readonly Op[]> {
      return runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const before = commits.length;
          push((api) =>
            runPromise(
              Effect.gen(function* () {
                yield* awaited(action(api));
                return true;
              }),
            ),
          );
          yield* waitFor(() => commits.length > before);
          return commits.at(-1)!;
        }),
      );
    },
    finish(): Promise<readonly Op[][]> {
      return runPromise(
        Effect.gen(function* () {
          const before = commits.length;
          push(() => Promise.resolve(false));
          yield* awaited(submission.wait(context));
          return commits.slice(before);
        }),
      );
    },
  };
});

export function live(harness: Harness): Promise<Readonly<LiveState> | undefined> {
  return harness.snapshot(LiveDoc, 1 as never, context);
}

export const OUTPUT = ["tools", 0, "output"];
