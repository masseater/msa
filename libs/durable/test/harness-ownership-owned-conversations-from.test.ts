import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import { type ConversationId, configure, defineTool, type TaskId } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { chatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { directories, gates, Hold, runs, gated } from "./harness-ownership-support.ts";
import { addTask, addTool } from "./harness-support.ts";
import { makeTempFile, removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
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

const replaySafeSubagent = Effect.fn("replaySafeSubagent")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { directory, path } = yield* makeTempFile("msa-durable-safe-subagent-", "session.sqlite");
  directories.add(directory);
  const children: ConversationId[] = [];
  const setup = chatSetup();
  addTool(
    setup.registry,
    defineTool({
      name: "subagent",
      description: "Delegates",
      parameters: Type.Object({}),
      replay: "safe",
      execute: (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            const child = yield* awaited(
              api.commit(
                (tx) =>
                  runPromise(
                    Effect.gen(function* () {
                      const existing = (yield* awaited(
                        tx.scanConversations({ ownerTaskId: api.taskId }, 1),
                      )).items[0];
                      if (existing !== undefined) return existing.id;
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
            children.push(child);
            const request = {
              type: "input",
              content: "child task",
              requestId: `subagent:${api.taskId}`,
            } as const;
            const submission = yield* awaited(
              (yield* awaited(api.conversation(child, callContext)))!.submit(request, callContext),
            );
            const settled = yield* awaited(submission.wait(callContext));
            return { output: [{ type: "text", text: settled.status }] };
          }),
        ),
    }),
  );
  const childRun = gated(fauxAssistantMessage([fauxText("never")]));
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("subagent", {}, { id: "c1" })], { stopReason: "toolUse" }),
    childRun.step,
  ]);
  return { path, children, setup, childRun };
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

const rerunsReplaySafe = Effect.gen(function* () {
  const { path, children, setup, childRun } = yield* replaySafeSubagent();
  let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  const input = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(childRun.reached);
  yield* awaited(opened.harness.close(context));

  setup.faux.setResponses([
    fauxAssistantMessage([fauxText("child answer")]),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(input, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(children).toHaveLength(2);
  expect(children[1]).toBe(children[0]);
  const child = (yield* awaited(opened.harness.conversation(children[0]!, context)))!;
  const entries = (yield* awaited(child.entries({}, 100, undefined, context))).items;
  expect(entries.filter((entry) => entry.kind === "msa.user")).toHaveLength(1);
  const results = (yield* awaited(opened.root.context(context))).messages.filter(
    (message) => message.role === "toolResult",
  );
  expect(results.map((message) => message.isError)).toEqual([false]);
  yield* awaited(opened.harness.close(context));
});

describe("owned conversations from tools and supervisors", () => {
  it("reruns a replay-safe subagent tool after a restart with the same child and submission", () =>
    Effect.runPromise(rerunsReplaySafe));
});
