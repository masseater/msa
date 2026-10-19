import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import {
  type ConversationHandle,
  type ConversationId,
  defineTool,
  type Submission,
  type TaskId,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { spawnFauxChild } from "./harness-ownership-children.ts";
import {
  directories,
  gates,
  open,
  openHarness,
  ownedChild,
  runs,
} from "./harness-ownership-support.ts";
import {
  chatSetup,
  openChat,
  awaited,
  addTool,
  removeDir,
  ControlledStorage,
  context,
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
            const child = yield* spawnFauxChild(api, callContext);
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
