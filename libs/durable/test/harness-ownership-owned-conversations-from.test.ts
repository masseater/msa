import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import {
  type ConversationId,
  configure,
  defineTool,
  MemoryStorage,
  type TaskId,
} from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { chatSetup, openChat } from "./chat-support.ts";
import { directories, gates, Hold, runs, gated } from "./harness-ownership-support.ts";
import { addTask, addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";
import { makeTempFile, removeDir } from "./temp-support.ts";

afterEach(async () => {
  gates.clear();
  runs.clear();
  for await (const directory of directories) await removeDir(directory);
  directories.clear();
});

async function spawningTool() {
  const { directory, path } = await makeTempFile("msa-durable-tool-children-", "session.sqlite");
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
      execute: async (args, api, callContext) => {
        const child = await api.commit(async (tx) => {
          const created = await tx.createConversation({
            ownership: { kind: "task", taskId: api.taskId },
          });
          return tx.createTask(
            Hold,
            { name: `child.${api.callId}` },
            { ownership: { kind: "conversation" }, conversationId: created.id },
          );
        }, callContext);
        children.push(child);
        if (args.mode === "throw") throw new Error("spawn failed");
        toolRunning.resolve();
        return aborted(callContext.abortSignal!);
      },
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
}

async function replaySafeSubagent() {
  const { directory, path } = await makeTempFile("msa-durable-safe-subagent-", "session.sqlite");
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
      execute: async (_args, api, callContext) => {
        const child = await api.commit(async (tx) => {
          const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
          if (existing !== undefined) return existing.id;
          const created = await tx.createConversation({
            ownership: { kind: "task", taskId: api.taskId },
          });
          await configure(tx, created.id, { model: { provider: "faux", modelId: "faux-1" } });
          return created.id;
        }, callContext);
        children.push(child);
        const request = {
          type: "input",
          content: "child task",
          requestId: `subagent:${api.taskId}`,
        } as const;
        const submission = await (await api.conversation(child, callContext))!.submit(
          request,
          callContext,
        );
        const settled = await submission.wait(callContext);
        return { output: [{ type: "text", text: settled.status }] };
      },
    }),
  );
  const childRun = gated(fauxAssistantMessage([fauxText("never")]));
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("subagent", {}, { id: "c1" })], { stopReason: "toolUse" }),
    childRun.step,
  ]);
  return { path, children, setup, childRun };
}

describe("owned conversations from tools and supervisors", () => {
  it("lets a running tool abort its owned child and continue", async () => {
    const setup = chatSetup();
    const childRun = gated(fauxAssistantMessage([fauxText("never")]));
    addTool(
      setup.registry,
      defineTool({
        name: "delegate",
        description: "Delegates and cancels",
        parameters: Type.Object({}),
        execute: async (_args, api, callContext) => {
          const child = await api.commit(async (tx) => {
            const created = await tx.createConversation({
              ownership: { kind: "task", taskId: api.taskId },
            });
            await configure(tx, created.id, { model: { provider: "faux", modelId: "faux-1" } });
            return created.id;
          }, callContext);
          const handle = (await api.conversation(child, callContext))!;
          const submission = await handle.submit(
            { type: "input", content: "child task" },
            callContext,
          );
          await childRun.reached;
          await handle.abort(callContext);
          const settledChild = await submission.wait(callContext);
          return { output: [{ type: "text", text: `child ${settledChild.status}` }] };
        },
      }),
    );
    setup.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("delegate", {}, { id: "c1" })], { stopReason: "toolUse" }),
      childRun.step,
      fauxAssistantMessage([fauxText("done")]),
    ]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    expect(
      (await (await root.submit({ type: "input", content: "go" }, context)).wait(context)).status,
    ).toBe("done");
    await harness.close(context);
  });
});

describe("owned conversations from tools and supervisors", () => {
  it("aborts the children of a tool call that throws or is interrupted, while the run continues", async () => {
    const { path, children, toolRunning, setup } = await spawningTool();
    let opened = await openChat(await openNodeSqliteStorage(path), setup);
    expect(
      (await (await opened.root.submit({ type: "input", content: "one" }, context)).wait(context))
        .status,
    ).toBe("done");
    expect((await opened.harness.waitForTask(children[0]!, context)).state.outcome.status).toBe(
      "aborted",
    );

    // The second call hangs until the process stops; on reopen it is interrupted.
    const second = (await opened.root.submit({ type: "input", content: "two" }, context)).id;
    await toolRunning.promise;
    await opened.harness.close(context);
    setup.faux.setResponses([fauxAssistantMessage([fauxText("after interrupt")])]);
    opened = await openChat(await openNodeSqliteStorage(path), setup);
    opened.harness.resume();
    expect((await opened.harness.waitForTask(children[1]!, context)).state.outcome.status).toBe(
      "aborted",
    );
    expect((await (await opened.harness.submission(second, context))!.wait(context)).status).toBe(
      "done",
    );
    const tools = (
      await opened.harness.commit((tx) => tx.scanTasks({ kind: "msa.tool" }, 10), context)
    ).items;
    expect(
      tools.map((task) => task.state.status === "terminal" && task.state.outcome.status),
    ).toEqual(["failed", "failed"]);
    await opened.harness.close(context);
  });
});

describe("owned conversations from tools and supervisors", () => {
  it("reruns a replay-safe subagent tool after a restart with the same child and submission", async () => {
    const { path, children, setup, childRun } = await replaySafeSubagent();
    let opened = await openChat(await openNodeSqliteStorage(path), setup);
    const input = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await childRun.reached;
    await opened.harness.close(context);

    setup.faux.setResponses([
      fauxAssistantMessage([fauxText("child answer")]),
      fauxAssistantMessage([fauxText("done")]),
    ]);
    opened = await openChat(await openNodeSqliteStorage(path), setup);
    expect((await (await opened.harness.submission(input, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(children).toHaveLength(2);
    expect(children[1]).toBe(children[0]);
    const child = (await opened.harness.conversation(children[0]!, context))!;
    const entries = (await child.entries({}, 100, undefined, context)).items;
    expect(entries.filter((entry) => entry.kind === "msa.user")).toHaveLength(1);
    const results = (await opened.root.context(context)).messages.filter(
      (message) => message.role === "toolResult",
    );
    expect(results.map((message) => message.isError)).toEqual([false]);
    await opened.harness.close(context);
  });
});
