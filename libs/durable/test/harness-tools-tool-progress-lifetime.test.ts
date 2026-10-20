import { LiveDoc, defineTask } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessToolsSupport from "./harness-tools-support.ts";
import support from "./support.ts";

const { DONE, calls, resultText, results, run, tool } = harnessToolsSupport;
const { aborted, addHooks, addTool, allEntries, awaited, chatSetup, context, deferred, openChat } =
  support;

const rejectsInvocationBound = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const never = defineTask<Record<string, never>, { phase: "never" }, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "never" }),
    name: "test.never",
    phases: { never: () => Promise.resolve() },
    version: 1,
  });
  let wait!: Promise<unknown>;
  let watchClosed!: Promise<unknown>;
  addTool(
    setup.registry,
    tool("detach", (_args, api) =>
      runPromise(
        Effect.gen(function* () {
          const child = yield* awaited(
            api.createTask(never, {}, { ownership: { kind: "conversation" } }, context),
          );
          wait = api.waitForTask(child, context);
          wait.catch(() => {});
          const watch = yield* awaited(api.watchDoc(LiveDoc, api.conversationId, context));
          watchClosed = watch!.closed;
          return { output: [] };
        }),
      ),
    ),
  );
  const { harness } = yield* run(setup, [calls(["detach", {}, "c1"]), DONE]);
  yield* awaited(expect(wait).rejects.toThrow("invocation has ended"));
  yield* awaited(watchClosed);
  yield* awaited(harness.close(context));
});

describe("tool progress and lifetime", () => {
  it("rejects invocation-bound waits and stops watches when the tool's invocation ends", () =>
    Effect.runPromise(rejectsInvocationBound));
});

const rejectsDetailsStill = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  let pendingDetails!: Promise<void>;
  const inAfterTool = deferred();
  addTool(
    setup.registry,
    tool("slow", (_args, api) => {
      api.output("first\n");
      pendingDetails = api.details({ step: 1 }, context);
      pendingDetails.catch(() => {});
      return Promise.resolve({});
    }),
  );
  addHooks(setup.registry, ToolTask, {
    afterTool: (_call, _result, _api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          inAfterTool.resolve();
          return yield* awaited(aborted(callContext.abortSignal!));
        }),
      ),
  });
  setup.faux.setResponses([calls(["slow", {}, "c1"]), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* awaited(inAfterTool.promise);
  const taskId = (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.tools![0]!.taskId!;
  yield* awaited(harness.abortTask(taskId, context));
  yield* awaited(expect(pendingDetails).rejects.toBeDefined());
  yield* awaited(submission.wait(context));
  yield* awaited(harness.close(context));
});

describe("tool progress and lifetime", () => {
  it("rejects details() still waiting when the call is aborted during afterTool", () =>
    Effect.runPromise(rejectsDetailsStill));
});

const answersAbortedTool = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const { promise: buffered, resolve: reached } = Promise.withResolvers<void>();
  addTool(
    setup.registry,
    tool("slow", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          api.output("durable\n");
          yield* Effect.sleep(20);
          api.output("buffered\n");
          reached();
          return yield* awaited(aborted(callContext.abortSignal!));
        }),
      ),
    ),
  );
  setup.faux.setResponses([calls(["slow", {}, "c1"]), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* awaited(buffered);
  const taskId = (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.tools![0]!.taskId!;
  yield* awaited(harness.abortTask(taskId, context));
  yield* awaited(submission.wait(context));
  expect(resultText(results(yield* allEntries(root))[0]!)).toBe(
    "durable\n|<harness>\n[error] Tool slow was aborted\n</harness>",
  );
  yield* awaited(harness.close(context));
});

describe("tool progress and lifetime", () => {
  it("answers an aborted tool with only its durable output, discarding buffered output", () =>
    Effect.runPromise(answersAbortedTool));
});
