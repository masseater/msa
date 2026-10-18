import { fauxAssistantMessage, fauxText, Type } from "@msa/ai";
import {
  type AgentEvent,
  type ConversationId,
  defineTool,
  type Harness,
  LiveDoc,
  type TaskId,
} from "@msa/durable";
import { GenerationTask } from "@msa/durable/harness";
import { createSession } from "@msa/durable/session";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { chatSetup, openChat, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import {
  state,
  outcomeOf,
  open,
  gates,
  until,
  start,
  Node,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  parentOf,
  owned,
  script,
  spawnAndFinish,
  directories,
  sqlitePath,
  toolCalls,
  blockingTool,
  labels,
  listen,
} from "./harness-structured-support.ts";
import { addHooks, addTask, addTool } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { openTasks, settled } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      behaviors.clear();
      gates.clear();
      log.length = 0;
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const failsHarnessFailed = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let reject: TaskId | undefined;
  const failure = new Error("disk gone");
  class Failing extends ControlledStorage {
    override commit(
      writes: Parameters<MemoryStorage["commit"]>[0],
      ctx: Parameters<MemoryStorage["commit"]>[1],
    ) {
      const finalizes = writes.some(
        (write) =>
          write.type === "task" &&
          write.value.id === reject &&
          write.value.state.status === "terminal",
      );
      if (finalizes) {
        reject = undefined;
        return Promise.reject(failure);
      }
      return Promise.resolve(super.commit(writes, ctx));
    }
  }
  const storage = new Failing();
  const { harness, root, reports } = yield* openNodes(storage);
  spawnAndFinish("parent", "child");
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, parent)).status === "completing";
      }),
    ),
  );
  reject = parent;
  open("child");
  expect(yield* awaited(harness.closed)).toEqual({ reason: "failed", error: failure });
  expect(reports).toEqual([failure]);
  yield* awaited(harness.close(context));
  const reopened = yield* openNodes(storage.reopen());
  expect(yield* awaited(outcomeOf(reopened.harness, parent))).toBe("completed");
  yield* awaited(reopened.harness.close(context));
});

describe("conversation abort and boundaries", () => {
  it("fails the Harness on a failed finalization, which reopening applies", () =>
    Effect.runPromise(failsHarnessFailed));
});

const showsAbortMarked = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const session = createSession(yield* awaited(openNodeSqliteStorage(path)));
  const tree = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const conversation = yield* awaited(
              tx.createConversation({ ownership: { kind: "ownerless" } }),
            );
            const owner = yield* awaited(
              tx.createTask(
                Node,
                { name: "owner" },
                { ...OWN_CONVERSATION, conversationId: conversation.id },
              ),
            );
            const child = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: owner } }),
            );
            const inner = yield* awaited(
              tx.createTask(
                Node,
                { name: "inner" },
                { ...OWN_CONVERSATION, conversationId: child.id },
              ),
            );
            return { owner, inner };
          }),
        ),
      context,
    ),
  );
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const record = (yield* awaited(tx.task(tree.owner)))!;
            (tx as unknown as { setTask(value: unknown): void }).setTask({
              ...record,
              abortRequested: true,
            });
          }),
        ),
      context,
    ),
  );
  yield* awaited(session.close(context));

  const { harness } = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Node]);
  const inspected = (yield* awaited(harness.inspect(context))).tasks.find(
    (task) => task.record.id === tree.owner,
  );
  expect(inspected?.state).toEqual({ kind: "waiting", on: [tree.inner] });
  harness.resume();
  expect(yield* awaited(outcomeOf(harness, tree.owner))).toBe("aborted");
  expect(log.filter((line) => line.startsWith("abort:"))).toEqual(["abort:inner", "abort:owner"]);
  yield* awaited(harness.close(context));
});

describe("recovery through ownership edges", () => {
  it("shows an abort-marked owner waiting for work in its owned conversation before resume after reopen", () =>
    Effect.runPromise(showsAbortMarked));
});

const keepsRootBusy = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  let inner: TaskId | undefined;
  script("child", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const conversation = yield* awaited(
                      tx.createConversation({
                        ownership: { kind: "task", taskId: runtime.taskId },
                      }),
                    );
                    inner = yield* awaited(
                      tx.createTask(
                        Node,
                        { name: "inner" },
                        { ...OWN_CONVERSATION, conversationId: conversation.id },
                      ),
                    );
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  parentOf("parent", ["child"], "allSettled");
  let opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  const parent = yield* awaited(start(opened.root, "parent"));
  yield* until(() => log.includes("run:inner"));
  yield* awaited(opened.harness.close(context));

  opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  expect(yield* settled(opened.root.waitForIdle(context))).toBe(false);
  open("inner");
  yield* awaited(opened.root.waitForIdle(context));
  expect(yield* awaited(outcomeOf(opened.harness, parent))).toBe("completed");
  expect(inner).toBeDefined();
  yield* awaited(opened.harness.close(context));
});

describe("recovery through ownership edges", () => {
  it("keeps the root busy after reopen for work below a child task's owned conversation", () =>
    Effect.runPromise(keepsRootBusy));
});

const keepsFinishedBackground = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  let conversation: ConversationId | undefined;
  script("child", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    conversation = (yield* awaited(
                      tx.createConversation({
                        ownership: { kind: "task", taskId: runtime.taskId },
                      }),
                    )).id;
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  parentOf("background", ["child"], "allSettled");
  let opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  const background = yield* awaited(
    start(opened.root, "background", {
      ...OWN_CONVERSATION,
      background: true,
    }),
  );
  yield* awaited(opened.harness.waitForTask(background, context));
  yield* awaited(opened.harness.close(context));

  opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  const below = yield* awaited(
    start((yield* awaited(opened.harness.conversation(conversation!, context)))!, "below"),
  );
  yield* until(() => log.includes("run:below"));
  yield* awaited(opened.root.waitForIdle(context));
  yield* awaited(opened.root.abort(context));
  expect((yield* state(opened.harness, below)).status).toBe("running");
  yield* awaited(opened.root.abort(context, { background: true }));
  expect(yield* awaited(outcomeOf(opened.harness, below))).toBe("aborted");
  yield* awaited(opened.harness.close(context));
});

describe("recovery through ownership edges", () => {
  it("keeps a finished background ancestor a boundary after reopen, which { background: true } crosses", () =>
    Effect.runPromise(keepsFinishedBackground));
});

const endsAbortedSequential = Effect.gen(function* () {
  const setup = chatSetup();
  const one = blockingTool("one");
  addTool(setup.registry, one.registration);
  addTool(setup.registry, defineTool({ ...blockingTool("two").registration, name: "two" }));
  setup.faux.setResponses([toolCalls(["one", "c1"], ["two", "c2"], ["two", "c3"])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const { stream, events } = yield* listen(harness, root);
  const submission = yield* awaited(root.submit({ type: "input", content: "go" }, context));
  yield* awaited(one.started);
  yield* awaited(
    harness.abortTask(
      (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.run!.taskId,
      context,
    ),
  );
  yield* awaited(submission.wait(context));
  yield* waitFor(() => labels(events).includes("result:c3"));
  expect(labels(events).filter((label) => !label.startsWith("message:"))).toEqual([
    "end:c1:true",
    "result:c1",
    "end:c2:true",
    "result:c2",
    "end:c3:true",
    "result:c3",
  ]);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("tool rounds and events", () => {
  it("ends an aborted sequential round's unstarted calls with their result entries, right before them", () =>
    Effect.runPromise(endsAbortedSequential));
});

const emitsOneTurn = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTask(setup.registry, Node);
  addTool(
    setup.registry,
    defineTool({
      name: "noop",
      description: "Does nothing",
      parameters: Type.Object({}),
      execute: () => Promise.resolve({ output: [] }),
    }),
  );
  let opened: Harness | undefined;
  addHooks(setup.registry, GenerationTask, {
    afterTools: (_assistant, _results, api, callContext) =>
      runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              opened!.commit(
                (tx) => tx.createTask(Node, { name: "hooked" }, owned(api.taskId)),
                callContext,
              ),
            ),
          ),
        ),
      ),
  });
  setup.faux.setResponses([toolCalls(["noop", "c1"]), fauxAssistantMessage([fauxText("done")])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  opened = harness;
  const early = yield* listen(harness, root);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  const late = yield* listen(harness, root);
  open("hooked");
  const [first] = (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: "msa.generation" }, 1), context),
  )).items;
  yield* awaited(harness.waitForTask(first!.id, context));
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context));
  yield* waitFor(() => late.events.some((event) => event.type === "entry_appended"));
  const turns = (events: readonly AgentEvent[]) =>
    events.filter((event) => event.type === "turn_end").length;
  expect(turns(early.events)).toBe(2);
  expect(turns(late.events)).toBe(0);
  yield* awaited(early.stream.stop());
  yield* awaited(late.stream.stop());
  yield* awaited(harness.close(context));
});

describe("tool rounds and events", () => {
  it("emits one turn_end per generation, also for a stream attached while it holds", () =>
    Effect.runPromise(emitsOneTurn));
});
