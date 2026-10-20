import ai from "@msa/ai";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type harnessLiveDeltasSupportTypes from "./harness-live-deltas-support.types.ts";
import testSupport from "./support.ts";

const { Type, fauxAssistantMessage, fauxText, fauxToolCall } = ai;

const { LiveDoc, defineTool } = durable;
const { MemoryStorage } = memory;

const { chatSetup, openChat, waitFor } = testSupport;
const { awaited } = testSupport;
const { addTool } = testSupport;
const { context, documentChanges } = testSupport;

function drivenToolImpl(
  outputLimits: NonNullable<durableTypes.ToolRegistration["outputLimits"]>,
  actions: ((api: durableTypes.ToolExecutionApi) => Promise<boolean>)[],
  waker: { wake?: () => void },
) {
  return defineTool({
    description: "Driven by the test",
    execute: (_args, api, callContext) => {
      const next = (): Promise<Record<string, never>> =>
        Effect.runPromise(
          Effect.gen(function* () {
            const action = actions.shift();
            if (action === undefined) {
              const { promise, resolve, reject } = Promise.withResolvers<void>();
              waker.wake = resolve;
              const signal = callContext.abortSignal!;
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
              yield* awaited(promise);
            } else if (!(yield* awaited(action(api)))) {
              return {};
            }
            return yield* awaited(next());
          }),
        );
      return next();
    },
    name: "drive",
    outputLimits,
    parameters: Type.Object({}),
  });
}

const drivenTool: {
  (
    actions: ((api: durableTypes.ToolExecutionApi) => Promise<boolean>)[],
    waker: { wake?: () => void },
  ): (
    outputLimits: NonNullable<durableTypes.ToolRegistration["outputLimits"]>,
  ) => ReturnType<typeof drivenToolImpl>;
  (
    outputLimits: NonNullable<durableTypes.ToolRegistration["outputLimits"]>,
    actions: ((api: durableTypes.ToolExecutionApi) => Promise<boolean>)[],
    waker: { wake?: () => void },
  ): ReturnType<typeof drivenToolImpl>;
} = dual(3, drivenToolImpl);

const driveStep1 = Effect.fn("driveStep1")(function* (
  outputLimits: NonNullable<durableTypes.ToolRegistration["outputLimits"]> = {},
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const actions: ((api: durableTypes.ToolExecutionApi) => Promise<boolean>)[] = [];
  const waker: { wake?: () => void } = {};
  addTool(setup.registry, drivenTool(outputLimits, actions, waker));
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("drive", {}, { id: "c1" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const commits: harnessLiveDeltasSupportTypes.Op[][] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      if (change.record.kind === "msa.live" && change.ops.length > 0) commits.push([...change.ops]);
    }
  });
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* waitFor(
    Effect.gen(function* () {
      return (yield* awaited(live(harness)))?.tools?.[0]?.status === "running";
    }),
  );
  const push = (action: (api: durableTypes.ToolExecutionApi) => Promise<boolean>): void => {
    actions.push(action);
    waker.wake?.();
  };
  return { commits, harness, push, runPromise, submission };
});

const drive = Effect.fn("drive")(function* (
  outputLimits: NonNullable<durableTypes.ToolRegistration["outputLimits"]> = {},
) {
  const { runPromise, harness, commits, submission, push } = yield* driveStep1(outputLimits);
  return {
    commits,
    finish(): Promise<readonly harnessLiveDeltasSupportTypes.Op[][]> {
      return runPromise(
        Effect.gen(function* () {
          const before = commits.length;
          push(() => Promise.resolve(false));
          yield* awaited(submission.wait(context));
          return commits.slice(before);
        }),
      );
    },
    harness,
    step(
      action: harnessLiveDeltasSupportTypes.Action,
    ): Promise<readonly harnessLiveDeltasSupportTypes.Op[]> {
      return runPromise(
        Effect.gen(function* () {
          const runNested = Effect.runPromiseWith(yield* Effect.context<never>());

          const before = commits.length;
          push((api) =>
            runNested(
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
  };
});

function live(
  harness: durableTypes.Harness,
): Promise<Readonly<durableTypes.LiveState> | undefined> {
  return harness.snapshot(LiveDoc, 1 as never, context);
}

const OUTPUT = ["tools", 0, "output"];

const harnessLiveDeltasSupport = {
  OUTPUT,
  drive,
  drivenTool,
  live,
};

export default harnessLiveDeltasSupport;
