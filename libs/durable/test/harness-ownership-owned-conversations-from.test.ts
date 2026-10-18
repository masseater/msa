import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import { configure, defineTool, type TaskId } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { directories, gates, Hold, runs, gated } from "./harness-ownership-support.ts";
import {
  chatSetup,
  openChat,
  awaited,
  addTask,
  addTool,
  makeTempFile,
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

const spawningTool = Effect.fn("spawningTool")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { directory, path } = yield* makeTempFile("msa-durable-tool-children-", "session.sqlite");
  directories.add(directory);
  const children: TaskId[] = [];
  const toolRunning = deferred();
  const setup = chatSetup();
  addTask(setup.registry, Hold);
  addTool(
    setup.registry,
    defineTool({
      name: "spawn",
      description: "Starts owned work, then throws or hangs",
      parameters: Type.Object({ mode: Type.String() }),
      execute: (args, api, callContext) =>
        runPromise(
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
                      return yield* awaited(
                        tx.createTask(
                          Hold,
                          { name: `child.${api.callId}` },
                          { ownership: { kind: "conversation" }, conversationId: created.id },
                        ),
                      );
                    }),
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
    }),
  );
  const call = (mode: string, id: string) =>
    fauxAssistantMessage([fauxToolCall("spawn", { mode }, { id })], { stopReason: "toolUse" });
  setup.faux.setResponses([
    call("throw", "c1"),
    fauxAssistantMessage([fauxText("after throw")]),
    call("hang", "c2"),
  ]);
  return { path, children, toolRunning, setup };
});

const letsRunningTool = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const childRun = gated(fauxAssistantMessage([fauxText("never")]));
  addTool(
    setup.registry,
    defineTool({
      name: "delegate",
      description: "Delegates and cancels",
      parameters: Type.Object({}),
      execute: (_args, api, callContext) =>
        runPromise(
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
            const handle = (yield* awaited(api.conversation(child, callContext)))!;
            const submission = yield* awaited(
              handle.submit({ type: "input", content: "child task" }, callContext),
            );
            yield* awaited(childRun.reached);
            yield* awaited(handle.abort(callContext));
            const settledChild = yield* awaited(submission.wait(callContext));
            return { output: [{ type: "text", text: `child ${settledChild.status}` }] };
          }),
        ),
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
      (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
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
      (yield* awaited(opened.root.submit({ type: "input", content: "one" }, context))).wait(
        context,
      ),
    )).status,
  ).toBe("done");
  expect(
    (yield* awaited(opened.harness.waitForTask(children[0]!, context))).state.outcome.status,
  ).toBe("aborted");

  const second = (yield* awaited(opened.root.submit({ type: "input", content: "two" }, context)))
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
