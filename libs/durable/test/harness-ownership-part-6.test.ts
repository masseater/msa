import ai from "@msa/ai";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessOwnershipChildren from "./harness-ownership-children.ts";
import harnessOwnershipSupport from "./harness-ownership-support.ts";
import support from "./support.ts";

const { Type, fauxAssistantMessage, fauxText, fauxToolCall } = ai;

const { LiveDoc, defineTool } = durable;
const { MemoryStorage } = memory;

const { spawnFauxChild } = harnessOwnershipChildren;
const { directories, gated, gates, runs } = harnessOwnershipSupport;
const { aborted, addTool, awaited, chatSetup, context, deferred, openChat, removeDir } = support;

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
  const ready = deferred<{ child: durableTypes.ConversationId; taskId: durableTypes.TaskId }>();
  const go = deferred();
  const queued = deferred<{ submitting: Promise<unknown> }>();
  addTool(
    setup.registry,
    defineTool({
      description: "Delegates late",
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
            const submitting = handle.submit({ content: "late", type: "input" }, context);
            submitting.catch(() => {});
            queued.resolve({ submitting });
            return yield* awaited(aborted(callContext.abortSignal!));
          }),
        ),
      name: "delegate",
      parameters: Type.Object({}),
    }),
  );
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("delegate", {}, { id: "c1" })], { stopReason: "toolUse" }),
  ]);
  return { go, queued, ready, setup };
}

function delegateToGatedChild() {
  const setup = chatSetup();
  const spawned: { child?: durableTypes.ConversationId } = {};
  const toolWait = deferred<string>();
  addTool(
    setup.registry,
    defineTool({
      description: "Delegates",
      execute: (_args, api, callContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            spawned.child = yield* spawnFauxChild(api, callContext);
            const submission = yield* awaited(
              (yield* awaited(api.conversation(spawned.child, callContext)))!.submit(
                { content: "child task", type: "input" },
                callContext,
              ),
            );
            const settled = yield* awaited(submission.wait(callContext)).pipe(
              Effect.tapDefect((error) =>
                Effect.sync(() => toolWait.resolve((error as Error).message)),
              ),
            );
            return { output: [{ text: settled.status, type: "text" }] };
          }),
        ),
      name: "delegate",
      parameters: Type.Object({}),
    }),
  );
  const childRun = gated(fauxAssistantMessage([fauxText("never")]));
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("delegate", {}, { id: "c1" })], { stopReason: "toolUse" }),
    childRun.step,
  ]);
  return { childRun, setup, spawned, toolWait };
}

const rejectsHandleOperation = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { setup, ready, go, queued } = delegateLate();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(root.submit({ content: "go", type: "input" }, context));
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
  const input = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* awaited(childRun.reached);
  yield* awaited(root.abort(context));
  expect(yield* awaited(input.wait(context))).toMatchObject({
    reason: "aborted",
    status: "unanswered",
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
