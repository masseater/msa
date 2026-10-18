import { rm } from "node:fs/promises";

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
import { afterEach, describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
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
import { ControlledStorage, context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(async () => {
  gates.clear();
  runs.clear();
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("ownership", () => {
  it("fails the Harness on a failed cascade commit, and reopening applies the cascade", async () => {
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
    const { harness, root, reports } = await openHarness(storage);
    const tree = await ownedChild(root, "owner");
    failMark = tree.inner;
    open("owner", "failed");
    expect(await harness.closed).toEqual({ reason: "failed", error: failure });
    expect(reports).toEqual([failure]);
    await harness.close(context);
    const reopened = await openHarness(storage.reopen());
    expect((await reopened.harness.waitForTask(tree.inner, context)).state.outcome.status).toBe(
      "aborted",
    );
    await reopened.harness.close(context);
  });
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
      execute: async (_args, api, callContext) => {
        const child = await api.commit(async (tx) => {
          const created = await tx.createConversation({
            ownership: { kind: "task", taskId: api.taskId },
          });
          await configure(tx, created.id, { model: { provider: "faux", modelId: "faux-1" } });
          return created.id;
        }, callContext);
        got.missing = await api.conversation(99_999 as ConversationId, callContext);
        got.handle = (await api.conversation(child, callContext))!;
        got.submission = await got.handle.submit(
          { type: "input", content: "child task", requestId: "child" },
          callContext,
        );
        const settled = await got.submission.wait(callContext);
        return { output: [{ type: "text", text: settled.status }] };
      },
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
      execute: async (_args, api, callContext) => {
        const child = await api.commit(async (tx) => {
          const created = await tx.createConversation({
            ownership: { kind: "task", taskId: api.taskId },
          });
          return created.id;
        }, callContext);
        const handle = (await api.conversation(child, callContext))!;
        ready.resolve({ child, taskId: api.taskId });
        await go.promise;
        // Called while the invocation is alive, with a context that is not the call's: the handle binds it to the
        // invocation. It reaches the line only after the abort mark.
        const submitting = handle.submit({ type: "input", content: "late" }, context);
        submitting.catch(() => {});
        queued.resolve({ submitting });
        return aborted(callContext.abortSignal!);
      },
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
      execute: async (_args, api, callContext) => {
        spawned.child = await api.commit(async (tx) => {
          const created = await tx.createConversation({
            ownership: { kind: "task", taskId: api.taskId },
          });
          await configure(tx, created.id, { model: { provider: "faux", modelId: "faux-1" } });
          return created.id;
        }, callContext);
        const submission = await (await api.conversation(spawned.child, callContext))!.submit(
          { type: "input", content: "child task" },
          callContext,
        );
        try {
          return {
            output: [{ type: "text", text: (await submission.wait(callContext)).status }],
          };
        } catch (error) {
          toolWait.resolve((error as Error).message);
          throw error;
        }
      },
    }),
  );
  const childRun = gated(fauxAssistantMessage([fauxText("never")]));
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("delegate", {}, { id: "c1" })], { stopReason: "toolUse" }),
    childRun.step,
  ]);
  return { setup, spawned, toolWait, childRun };
}

describe("owned conversations from tools and supervisors", () => {
  it("gives a tool an invocation-bound handle whose submissions stay durable after the call ends", async () => {
    const { setup, got } = delegateThroughHandle();
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    expect(got.missing).toBeUndefined();
    // The call ended: the handle and its submission reject, while the submission record remains.
    await expect(got.handle!.submit({ type: "input", content: "again" }, context)).rejects.toThrow(
      "invocation has ended",
    );
    await expect(got.handle!.waitForIdle(context)).rejects.toThrow("invocation has ended");
    await expect(got.handle!.abort(context)).rejects.toThrow("invocation has ended");
    await expect(got.submission!.wait(context)).rejects.toThrow("invocation has ended");
    // Nothing was admitted or marked after the call ended.
    const childConversation = (await harness.conversation(got.handle!.id, context))!;
    const childEntries = (await childConversation.entries({}, 100, undefined, context)).items;
    expect(childEntries.filter((entry) => entry.kind === "msa.user")).toHaveLength(1);
    const childTasks = (await harness.inspect(context)).tasks.filter(
      (task) => task.record.conversationId === got.handle!.id,
    );
    expect(childTasks).toEqual([]);
    expect(
      (await (await harness.submission(got.submission!.id, context))!.status(context)).status,
    ).toBe("done");
    await harness.close(context);
  });
});

describe("owned conversations from tools and supervisors", () => {
  it("rejects a handle operation queued on the line when the invocation ends before it runs", async () => {
    const { setup, ready, go, queued } = delegateLate();
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    await root.submit({ type: "input", content: "go" }, context);
    const { child, taskId } = await ready.promise;
    // Hold the Session line, queue the abort mark behind it, then let the tool queue its submit.
    const release = deferred();
    const holding = root.commit(async () => {
      await release.promise;
    }, context);
    const aborting = harness.abortTask(taskId, context);
    go.resolve();
    const { submitting } = await queued.promise;
    release.resolve();
    await holding;
    await aborting;
    await expect(submitting).rejects.toThrow();
    const childConversation = (await harness.conversation(child, context))!;
    expect((await childConversation.entries({}, 10, undefined, context)).items).toEqual([]);
    expect(
      (await harness.inspect(context)).submissions.filter(
        (record) => record.conversationId === child,
      ),
    ).toEqual([]);
    await harness.close(context);
  });

  it("aborts a subagent run with its parent's conversation, rejecting the waiting tool", async () => {
    const { setup, spawned, toolWait, childRun } = delegateToGatedChild();
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const input = await root.submit({ type: "input", content: "go" }, context);
    await childRun.reached;
    await root.abort(context);
    expect(await input.wait(context)).toMatchObject({ status: "unanswered", reason: "aborted" });
    expect(await toolWait.promise).toBeTruthy();
    const childConversation = (await harness.conversation(spawned.child!, context))!;
    await childConversation.waitForIdle(context);
    const childLive = await harness.snapshot(LiveDoc, spawned.child!, context);
    expect(childLive).toEqual({});
    const childInputs = (await harness.inspect(context)).submissions.filter(
      (s) => s.conversationId === spawned.child,
    );
    expect(childInputs).toEqual([]);
    await harness.waitForIdle(context);
    await harness.close(context);
  });
});
