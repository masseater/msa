import { Type, fauxAssistantMessage, fauxText, fauxToolCall } from "@msa/ai";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/storage/sqlite/node.ts";
import harnessOwnershipChildren from "./harness-ownership-children.ts";
import harnessOwnershipSupport from "./harness-ownership-support.ts";
import support from "./support.ts";

const { defineTool } = durable;
const { MemoryStorage } = memory;
const { openNodeSqliteStorage } = node;

const { spawnFauxChild } = harnessOwnershipChildren;
const { Hold, directories, gated, gates, runs } = harnessOwnershipSupport;
const {
  aborted,
  addTask,
  addTool,
  awaited,
  chatSetup,
  context,
  deferred,
  makeTempFile,
  openChat,
  removeDir,
} = support;

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

const spawningTool = Effect.fn("spawningTool")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { directory, path } = yield* makeTempFile("msa-durable-tool-children-", "session.sqlite");
  directories.add(directory);
  const children: durableTypes.TaskId[] = [];
  const toolRunning = deferred();
  const setup = chatSetup();
  addTask(setup.registry, Hold);
  addTool(
    setup.registry,
    defineTool({
      description: "Starts owned work, then throws or hangs",
      execute: (args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            const child = yield* awaited(
              api.commit(
                (tx) =>
                  tx
                    .createConversation({ ownership: { kind: "task", taskId: api.taskId } })
                    .then((created) =>
                      tx.createTask(
                        Hold,
                        { name: `child.${api.callId}` },
                        { conversationId: created.id, ownership: { kind: "conversation" } },
                      ),
                    ),
                callContext,
              ),
            );
            children.push(child);
            if (args.mode === "throw") throw new Error("spawn failed");
            toolRunning.resolve();
            return yield* awaited(aborted(callContext.abortSignal!));
          }),
        ),
      name: "spawn",
      parameters: Type.Object({ mode: Type.String() }),
    }),
  );
  const call = (mode: string, id: string) =>
    fauxAssistantMessage([fauxToolCall("spawn", { mode }, { id })], { stopReason: "toolUse" });
  setup.faux.setResponses([
    call("throw", "c1"),
    fauxAssistantMessage([fauxText("after throw")]),
    call("hang", "c2"),
  ]);
  return { children, path, setup, toolRunning };
});

const letsRunningTool = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const childRun = gated(fauxAssistantMessage([fauxText("never")]));
  addTool(
    setup.registry,
    defineTool({
      description: "Delegates and cancels",
      execute: (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            const child = yield* spawnFauxChild(api, callContext);
            const handle = (yield* awaited(api.conversation(child, callContext)))!;
            const submission = yield* awaited(
              handle.submit({ content: "child task", type: "input" }, callContext),
            );
            yield* awaited(childRun.reached);
            yield* awaited(handle.abort(callContext));
            const settledChild = yield* awaited(submission.wait(callContext));
            return { output: [{ text: `child ${settledChild.status}`, type: "text" }] };
          }),
        ),
      name: "delegate",
      parameters: Type.Object({}),
    }),
  );
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("delegate", {}, { id: "c1" })], {
      stopReason: "toolUse",
    }),
    childRun.step,
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  expect(
    (yield* awaited(
      (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
    )).status,
  ).toBe("done");
  yield* awaited(harness.close(context));
});

describe("owned conversations from tools and supervisors", () => {
  it("lets a running tool abort its owned child and continue", () =>
    Effect.runPromise(letsRunningTool));
});

const abortsChildrenTool = Effect.gen(function* () {
  const { path, children, toolRunning, setup } = yield* spawningTool();
  let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  expect(
    (yield* awaited(
      (yield* awaited(opened.root.submit({ content: "one", type: "input" }, context))).wait(
        context,
      ),
    )).status,
  ).toBe("done");
  expect(
    (yield* awaited(opened.harness.waitForTask(children[0]!, context))).state.outcome.status,
  ).toBe("aborted");

  const second = (yield* awaited(opened.root.submit({ content: "two", type: "input" }, context)))
    .id;
  yield* awaited(toolRunning.promise);
  yield* awaited(opened.harness.close(context));
  setup.faux.setResponses([fauxAssistantMessage([fauxText("after interrupt")])]);
  opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  opened.harness.resume();
  expect(
    (yield* awaited(opened.harness.waitForTask(children[1]!, context))).state.outcome.status,
  ).toBe("aborted");
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(second, context)))!.wait(context)))
      .status,
  ).toBe("done");
  const tools = (yield* awaited(
    opened.harness.commit((tx) => tx.scanTasks({ kind: "msa.tool" }, 10), context),
  )).items;
  expect(
    tools.map((task) => task.state.status === "terminal" && task.state.outcome.status),
  ).toEqual(["failed", "failed"]);
  yield* awaited(opened.harness.close(context));
});

describe("owned conversations from tools and supervisors", () => {
  it("aborts the children of a tool call that throws or is interrupted, while the run continues", () =>
    Effect.runPromise(abortsChildrenTool));
});
