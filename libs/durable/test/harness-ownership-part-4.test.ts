import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import {
  type ConversationHandle,
  type ConversationId,
  configure,
  defineTool,
  LiveDoc,
  type Submission,
  type TaskId,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import {
  directories,
  open,
  gates,
  ownedChild,
  runs,
  openHarness,
  gated,
} from "./harness-ownership-support.ts";
import { addTool } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

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

const failsHarnessFailed = Effect.gen(function* () {
  const failure = new Error("disk gone");
  let failMark: TaskId | undefined;
  class Failing extends ControlledStorage {
    override commit(
      writes: Parameters<MemoryStorage["commit"]>[0],
      ctx: Parameters<MemoryStorage["commit"]>[1],
    ) {
      const marks = writes.some(
        (write) =>
          write.type === "task" && write.value.id === failMark && write.value.abortRequested,
      );
      if (marks) {
        failMark = undefined;
        return Promise.reject(failure);
      }
      return Promise.resolve(super.commit(writes, ctx));
    }
  }
  const storage = new Failing();
  const { harness, root, reports } = yield* openHarness(storage);
  const tree = yield* awaited(ownedChild(root, "owner"));
  failMark = tree.inner;
  open("owner", "failed");
  expect(yield* awaited(harness.closed)).toEqual({ reason: "failed", error: failure });
  expect(reports).toEqual([failure]);
  yield* awaited(harness.close(context));
  const reopened = yield* openHarness(storage.reopen());
  expect(
    (yield* awaited(reopened.harness.waitForTask(tree.inner, context))).state.outcome.status,
  ).toBe("aborted");
  yield* awaited(reopened.harness.close(context));
});

describe("ownership", () => {
  it("fails the Harness on a failed cascade commit, and reopening applies the cascade", () =>
    Effect.runPromise(failsHarnessFailed));
});

function delegateThroughHandle() {
  const setup = chatSetup();
  const got: {
    handle?: ConversationHandle;
    missing: ConversationHandle | undefined;
    submission?: Submission;
  } = { missing: {} as ConversationHandle };
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
            got.missing = yield* awaited(api.conversation(99_999 as ConversationId, callContext));
            got.handle = (yield* awaited(api.conversation(child, callContext)))!;
            got.submission = yield* awaited(
              got.handle.submit(
                { type: "input", content: "child task", requestId: "child" },
                callContext,
              ),
            );
            const settled = yield* awaited(got.submission.wait(callContext));
            return { output: [{ type: "text", text: settled.status }] };
          }),
        ),
    }),
  );
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("delegate", {}, { id: "c1" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("child answer")]),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  return { setup, got };
}

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

const givesToolInvocation = Effect.gen(function* () {
  const { setup, got } = delegateThroughHandle();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  expect(got.missing).toBeUndefined();
  yield* awaited(
    expect(got.handle!.submit({ type: "input", content: "again" }, context)).rejects.toThrow(
      "invocation has ended",
    ),
  );
  yield* awaited(expect(got.handle!.waitForIdle(context)).rejects.toThrow("invocation has ended"));
  yield* awaited(expect(got.handle!.abort(context)).rejects.toThrow("invocation has ended"));
  yield* awaited(expect(got.submission!.wait(context)).rejects.toThrow("invocation has ended"));
  const childConversation = (yield* awaited(harness.conversation(got.handle!.id, context)))!;
  const childEntries = (yield* awaited(childConversation.entries({}, 100, undefined, context)))
    .items;
  expect(childEntries.filter((entry) => entry.kind === "msa.user")).toHaveLength(1);
  const childTasks = (yield* awaited(harness.inspect(context))).tasks.filter(
    (task) => task.record.conversationId === got.handle!.id,
  );
  expect(childTasks).toEqual([]);
  expect(
    (yield* awaited(
      (yield* awaited(harness.submission(got.submission!.id, context)))!.status(context),
    )).status,
  ).toBe("done");
  yield* awaited(harness.close(context));
});

describe("owned conversations from tools and supervisors", () => {
  it("gives a tool an invocation-bound handle whose submissions stay durable after the call ends", () =>
    Effect.runPromise(givesToolInvocation));
});

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
