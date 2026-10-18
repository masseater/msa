import { rm } from "node:fs/promises";

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
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { chatSetup, openChat, waitFor } from "./chat-support.ts";
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
import { ControlledStorage, context } from "./session-support.ts";
import { openTasks, settled } from "./task-support.ts";

afterEach(async () => {
  behaviors.clear();
  gates.clear();
  log.length = 0;
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("conversation abort and boundaries", () => {
  it("fails the Harness on a failed finalization, which reopening applies", async () => {
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
    const { harness, root, reports } = await openNodes(storage);
    spawnAndFinish("parent", "child");
    const parent = await start(root, "parent");
    await until(async () => (await state(harness, parent)).status === "completing");
    reject = parent;
    open("child");
    expect(await harness.closed).toEqual({ reason: "failed", error: failure });
    expect(reports).toEqual([failure]);
    await harness.close(context);
    const reopened = await openNodes(storage.reopen());
    expect(await outcomeOf(reopened.harness, parent)).toBe("completed");
    await reopened.harness.close(context);
  });
});

describe("recovery through ownership edges", () => {
  it("shows an abort-marked owner waiting for work in its owned conversation before resume after reopen", async () => {
    const path = await sqlitePath();
    const session = createSession(await openNodeSqliteStorage(path));
    const tree = await session.commit(async (tx) => {
      const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
      const owner = await tx.createTask(
        Node,
        { name: "owner" },
        { ...OWN_CONVERSATION, conversationId: conversation.id },
      );
      const child = await tx.createConversation({ ownership: { kind: "task", taskId: owner } });
      const inner = await tx.createTask(
        Node,
        { name: "inner" },
        { ...OWN_CONVERSATION, conversationId: child.id },
      );
      return { owner, inner };
    }, context);
    await session.commit(async (tx) => {
      const record = (await tx.task(tree.owner))!;
      (tx as unknown as { setTask(value: unknown): void }).setTask({
        ...record,
        abortRequested: true,
      });
    }, context);
    await session.close(context);

    const { harness } = await openTasks(await openNodeSqliteStorage(path), [Node]);
    const inspected = (await harness.inspect(context)).tasks.find(
      (task) => task.record.id === tree.owner,
    );
    expect(inspected?.state).toEqual({ kind: "waiting", on: [tree.inner] });
    harness.resume();
    expect(await outcomeOf(harness, tree.owner)).toBe("aborted");
    expect(log.filter((line) => line.startsWith("abort:"))).toEqual(["abort:inner", "abort:owner"]);
    await harness.close(context);
  });
});

describe("recovery through ownership edges", () => {
  it("keeps the root busy after reopen for work below a child task's owned conversation", async () => {
    const path = await sqlitePath();
    let inner: TaskId | undefined;
    script("child", {
      run: async (runtime, ctx) => {
        await runtime.commit(async (tx) => {
          const conversation = await tx.createConversation({
            ownership: { kind: "task", taskId: runtime.taskId },
          });
          inner = await tx.createTask(
            Node,
            { name: "inner" },
            { ...OWN_CONVERSATION, conversationId: conversation.id },
          );
          return { status: "running", checkpoint: { phase: "resume", round: 1 } };
        }, ctx);
      },
    });
    parentOf("parent", ["child"], "allSettled");
    let opened = await openNodes(await openNodeSqliteStorage(path));
    const parent = await start(opened.root, "parent");
    await until(() => log.includes("run:inner"));
    await opened.harness.close(context);

    opened = await openNodes(await openNodeSqliteStorage(path));
    expect(await settled(opened.root.waitForIdle(context))).toBe(false);
    open("inner");
    await opened.root.waitForIdle(context);
    expect(await outcomeOf(opened.harness, parent)).toBe("completed");
    expect(inner).toBeDefined();
    await opened.harness.close(context);
  });
});

describe("recovery through ownership edges", () => {
  it("keeps a finished background ancestor a boundary after reopen, which { background: true } crosses", async () => {
    const path = await sqlitePath();
    let conversation: ConversationId | undefined;
    script("child", {
      run: async (runtime, ctx) => {
        await runtime.commit(async (tx) => {
          conversation = (
            await tx.createConversation({ ownership: { kind: "task", taskId: runtime.taskId } })
          ).id;
          return { status: "running", checkpoint: { phase: "resume", round: 1 } };
        }, ctx);
      },
    });
    parentOf("background", ["child"], "allSettled");
    let opened = await openNodes(await openNodeSqliteStorage(path));
    const background = await start(opened.root, "background", {
      ...OWN_CONVERSATION,
      background: true,
    });
    await opened.harness.waitForTask(background, context);
    await opened.harness.close(context);

    opened = await openNodes(await openNodeSqliteStorage(path));
    const below = await start(
      (await opened.harness.conversation(conversation!, context))!,
      "below",
    );
    await until(() => log.includes("run:below"));
    await opened.root.waitForIdle(context);
    await opened.root.abort(context);
    expect((await state(opened.harness, below)).status).toBe("running");
    await opened.root.abort(context, { background: true });
    expect(await outcomeOf(opened.harness, below)).toBe("aborted");
    await opened.harness.close(context);
  });
});

describe("tool rounds and events", () => {
  it("ends an aborted sequential round's unstarted calls with their result entries, right before them", async () => {
    const setup = chatSetup();
    const one = blockingTool("one");
    addTool(setup.registry, one.registration);
    addTool(setup.registry, defineTool({ ...blockingTool("two").registration, name: "two" }));
    setup.faux.setResponses([toolCalls(["one", "c1"], ["two", "c2"], ["two", "c3"])]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const { stream, events } = await listen(harness, root);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await one.started;
    await harness.abortTask(
      (await harness.snapshot(LiveDoc, root.id, context))!.run!.taskId,
      context,
    );
    await submission.wait(context);
    await waitFor(() => labels(events).includes("result:c3"));
    expect(labels(events).filter((label) => !label.startsWith("message:"))).toEqual([
      "end:c1:true",
      "result:c1",
      "end:c2:true",
      "result:c2",
      "end:c3:true",
      "result:c3",
    ]);
    await stream.stop();
    await harness.close(context);
  });
});

describe("tool rounds and events", () => {
  it("emits one turn_end per generation, also for a stream attached while it holds", async () => {
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
      afterTools: async (_assistant, _results, api, callContext) => {
        await opened!.commit(
          (tx) => tx.createTask(Node, { name: "hooked" }, owned(api.taskId)),
          callContext,
        );
      },
    });
    setup.faux.setResponses([toolCalls(["noop", "c1"]), fauxAssistantMessage([fauxText("done")])]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    opened = harness;
    const early = await listen(harness, root);
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    const late = await listen(harness, root);
    open("hooked");
    const [first] = (
      await harness.commit((tx) => tx.scanTasks({ kind: "msa.generation" }, 1), context)
    ).items;
    await harness.waitForTask(first!.id, context);
    await root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
    await waitFor(() => late.events.some((event) => event.type === "entry_appended"));
    const turns = (events: readonly AgentEvent[]) =>
      events.filter((event) => event.type === "turn_end").length;
    expect(turns(early.events)).toBe(2);
    expect(turns(late.events)).toBe(0);
    await early.stream.stop();
    await late.stream.stop();
    await harness.close(context);
  });
});
