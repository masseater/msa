import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import { type ConversationId, configure, defineTool, LiveDoc, type TaskId } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { directories, gates, runs, gated } from "./harness-ownership-support.ts";
import {
  chatSetup,
  openChat,
  awaited,
  addTool,
  removeDir,
  context,
  aborted,
  deferred,
} from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      gates.clear();
      runs.clear();
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

function delegateLate() {
  const setup = chatSetup();
  const ready = deferred<{ child: ConversationId; taskId: TaskId }>();
  const go = deferred();
  const queued = deferred<{ submitting: Promise<unknown> }>();
  addTool(
    setup.registry,
    defineTool({
      name: "delegate",
      description: "Delegates late",
      parameters: Type.Object({}),
      execute: (_args, api, callContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            const child = yield* awaited(
              api.commit(
                (tx) =>
                  runPromise(
                    Effect.gen(function* () {
                      const created = yield* awaited(
                        tx.createConversation({
                          ownership: { kind: "task", taskId: api.taskId },
                        }),
                      );
                      return created.id;
                    }),
                  ),
                callContext,
              ),
            );
            const handle = (yield* awaited(api.conversation(child, callContext)))!;
            ready.resolve({ child, taskId: api.taskId });
            yield* awaited(go.promise);
            const submitting = handle.submit({ type: "input", content: "late" }, context);
            submitting.catch(() => {});
            queued.resolve({ submitting });
            return yield* awaited(aborted(callContext.abortSignal!));
          }),
        ),
    }),
  );
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("delegate", {}, { id: "c1" })], { stopReason: "toolUse" }),
  ]);
  return { setup, ready, go, queued };
}

function delegateToGatedChild() {
  const setup = chatSetup();
  const spawned: { child?: ConversationId } = {};
  const toolWait = deferred<string>();
  addTool(
    setup.registry,
    defineTool({
      name: "delegate",
      description: "Delegates",
      parameters: Type.Object({}),
      execute: (_args, api, callContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            spawned.child = yield* awaited(
              api.commit(
                (tx) =>
                  runPromise(
                    Effect.gen(function* () {
                      const created = yield* awaited(
                        tx.createConversation({
                          ownership: { kind: "task", taskId: api.taskId },
                        }),
                      );
                      yield* awaited(
                        configure(tx, created.id, {
                          model: { provider: "faux", modelId: "faux-1" },
                        }),
                      );
                      return created.id;
                    }),
                  ),
                callContext,
              ),
            );
            const submission = yield* awaited(
              (yield* awaited(api.conversation(spawned.child, callContext)))!.submit(
                { type: "input", content: "child task" },
                callContext,
              ),
            );
            const settled = yield* awaited(submission.wait(callContext)).pipe(
              Effect.tapDefect((error) =>
                Effect.sync(() => toolWait.resolve((error as Error).message)),
              ),
            );
            return { output: [{ type: "text", text: settled.status }] };
          }),
        ),
    }),
  );
  const childRun = gated(fauxAssistantMessage([fauxText("never")]));
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("delegate", {}, { id: "c1" })], { stopReason: "toolUse" }),
    childRun.step,
  ]);
  return { setup, spawned, toolWait, childRun };
}

const rejectsHandleOperation = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { setup, ready, go, queued } = delegateLate();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(root.submit({ type: "input", content: "go" }, context));
  const { child, taskId } = yield* awaited(ready.promise);
  const release = deferred();
  const holding = root.commit(
    () => runPromise(Effect.asVoid(Effect.suspend(() => awaited(release.promise)))),
    context,
  );
  const aborting = harness.abortTask(taskId, context);
  go.resolve();
  const { submitting } = yield* awaited(queued.promise);
  release.resolve();
  yield* awaited(holding);
  yield* awaited(aborting);
  yield* awaited(expect(submitting).rejects.toThrow());
  const childConversation = (yield* awaited(harness.conversation(child, context)))!;
  expect((yield* awaited(childConversation.entries({}, 10, undefined, context))).items).toEqual([]);
  expect(
    (yield* awaited(harness.inspect(context))).submissions.filter(
      (record) => record.conversationId === child,
    ),
  ).toEqual([]);
  yield* awaited(harness.close(context));
});

const abortsSubagentRun = Effect.gen(function* () {
  const { setup, spawned, toolWait, childRun } = delegateToGatedChild();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ type: "input", content: "go" }, context));
  yield* awaited(childRun.reached);
  yield* awaited(root.abort(context));
  expect(yield* awaited(input.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "aborted",
  });
  expect(yield* awaited(toolWait.promise)).toBeTruthy();
  const childConversation = (yield* awaited(harness.conversation(spawned.child!, context)))!;
  yield* awaited(childConversation.waitForIdle(context));
  const childLive = yield* awaited(harness.snapshot(LiveDoc, spawned.child!, context));
  expect(childLive).toEqual({});
  const childInputs = (yield* awaited(harness.inspect(context))).submissions.filter(
    (s) => s.conversationId === spawned.child,
  );
  expect(childInputs).toEqual([]);
  yield* awaited(harness.waitForIdle(context));
  yield* awaited(harness.close(context));
});

describe("owned conversations from tools and supervisors", () => {
  it("rejects a handle operation queued on the line when the invocation ends before it runs", () =>
    Effect.runPromise(rejectsHandleOperation));

  it("aborts a subagent run with its parent's conversation, rejecting the waiting tool", () =>
    Effect.runPromise(abortsSubagentRun));
});
