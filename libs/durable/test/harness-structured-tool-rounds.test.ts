import { rm } from "node:fs/promises";

import { fauxAssistantMessage, fauxText, type Models, type ToolResultMessage, Type } from "@msa/ai";
import {
  type AgentEvent,
  defineTool,
  GenerationTask,
  type Harness,
  LiveDoc,
  MemoryStorage,
  type TaskId,
  ToolResultEntry,
  watchEvents,
} from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat, waitFor } from "./chat-support.ts";
import {
  state,
  outcomeOf,
  open,
  gate,
  gates,
  Node,
  behaviors,
  log,
  owned,
  script,
  directories,
  toolCalls,
  blockingTool,
} from "./harness-structured-support.ts";
import { addHooks, addTask, addTool } from "./harness-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { settled } from "./task-support.ts";

afterEach(async () => {
  behaviors.clear();
  gates.clear();
  log.length = 0;
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

async function faultedGenerationSetup() {
  const base = chatSetup();
  const models = new Proxy(base.models, {
    get(target, property) {
      if (property === "streamSimple") return invalidFinalStream;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const setup = { ...base, models };
  addTask(setup.registry, Node);
  const faulted: { opened?: Harness; reject?: TaskId } = {};
  addHooks(setup.registry, GenerationTask, {
    beforeRequest: async (_request, api, callContext) => {
      await faulted.opened!.commit(
        (tx) => tx.createTask(Node, { name: "hooked" }, owned(api.taskId)),
        callContext,
      );
      return undefined;
    },
  });
  script("hooked", {
    abort: async (runtime, ctx) => {
      await gate("abort.hooked").promise;
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
    },
  });
  const failure = new Error("disk gone");
  class Failing extends ControlledStorage {
    override commit(
      writes: Parameters<MemoryStorage["commit"]>[0],
      ctx: Parameters<MemoryStorage["commit"]>[1],
    ) {
      const finalizes = writes.some(
        (write) =>
          write.type === "task" &&
          write.value.id === faulted.reject &&
          write.value.state.status === "terminal",
      );
      if (finalizes) {
        faulted.reject = undefined;
        return Promise.reject(failure);
      }
      return Promise.resolve(super.commit(writes, ctx));
    }
  }
  const storage = new Failing();
  const { harness, root } = await openChat(storage, setup);
  return { setup, faulted, failure, storage, harness, root };
}

describe("tool rounds", () => {
  it("answers the unstarted calls of an aborted sequential round with aborted results, in call order", async () => {
    const setup = chatSetup();
    const one = blockingTool("one");
    addTool(setup.registry, one.registration);
    addTool(setup.registry, defineTool({ ...blockingTool("two").registration, name: "two" }));
    setup.faux.setResponses([toolCalls(["one", "c1"], ["two", "c2"], ["two", "c3"])]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await one.started;
    expect(
      (await harness.snapshot(LiveDoc, root.id, context))!.tools!.map(
        (slot) => slot.taskId !== undefined,
      ),
    ).toEqual([true, false, false]);
    const generation = (await harness.snapshot(LiveDoc, root.id, context))!.run!.taskId;
    await harness.abortTask(generation, context);
    expect(await submission.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
    const results = (await allEntries(root))
      .filter((entry) => ToolResultEntry.is(entry))
      .map((entry) => entry.model![0] as ToolResultMessage);
    expect(results.map((result) => result.toolCallId)).toEqual(["c1", "c2", "c3"]);
    expect(results.map((result) => result.isError)).toEqual([true, true, true]);
    expect(results[1]!.content).toEqual([
      { type: "text", text: "<harness>\n[error] Tool two was aborted\n</harness>" },
    ]);
    const tools = (
      await harness.commit(
        (tx) => tx.scanTasks({ conversationId: root.id, kind: "msa.tool" }, 20),
        context,
      )
    ).items;
    expect(tools).toHaveLength(1);
    await harness.close(context);
  });
});

describe("tool rounds", () => {
  it("ends a turn at the generation's hold, before its successor's turn starts", async () => {
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
    // An extension's hook starts work owned by the generation, which holds it while the next turn runs.
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
    const stream = await watchEvents(harness, root.id, context);
    const events: AgentEvent[] = [];
    stream.start((batch) => {
      events.push(...batch);

      return Promise.resolve();
    });
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    const first = (
      await harness.commit((tx) => tx.scanTasks({ kind: "msa.generation" }, 1), context)
    ).items[0]!;
    expect((await state(harness, first.id)).status).toBe("completing");
    const turns = () =>
      events.filter((event) => event.type.startsWith("turn_")).map((event) => event.type);
    await waitFor(() => turns().length === 4);
    expect(turns()).toEqual(["turn_start", "turn_end", "turn_start", "turn_end"]);
    open("hooked");
    expect(await outcomeOf(harness, first.id)).toBe("completed");
    await waitFor(() => turns().length === 4);
    await stream.stop();
    await harness.close(context);
  });
});

describe("tool rounds", () => {
  it("keeps run control with a faulted generation until its owned work drains, and fails the Harness on a failed final commit", async () => {
    const { setup, faulted, failure, storage, harness, root } = await faultedGenerationSetup();
    faulted.opened = harness;
    const submission = await root.submit({ type: "input", content: "hi" }, context);
    await waitFor(async () => {
      const generation = (await harness.snapshot(LiveDoc, root.id, context))?.run?.taskId;
      return generation !== undefined && (await state(harness, generation)).status === "completing";
    });
    const generation = (await harness.snapshot(LiveDoc, root.id, context))!.run!.taskId;
    expect(await state(harness, generation)).toMatchObject({
      status: "completing",
      outcome: { status: "faulted" },
    });
    expect(await settled(submission.wait(context))).toBe(false);
    expect((await harness.snapshot(LiveDoc, root.id, context))!.run?.taskId).toBe(generation);
    // The faulted outcome is cancellation intent: the hooked work is aborted, then the run settles.
    await waitFor(() => log.includes("abort:hooked"));
    faulted.reject = generation;
    open("abort.hooked");
    // The final commit, with the run's cleanup, fails: nothing of the cleanup lands, and the Harness fails.
    expect(await harness.closed).toEqual({ reason: "failed", error: failure });
    await expect(submission.wait(context)).rejects.toMatchObject({
      name: "SessionFailed",
      cause: failure,
    });
    await harness.close(context);
    // Reopening finalizes the run; the partial becomes one aborted entry.
    const reopened = await openChat(storage.reopen(), setup);
    faulted.opened = reopened.harness;
    const again = (await reopened.harness.submission(submission.id, context))!;
    expect(await again.wait(context)).toMatchObject({ status: "unanswered", reason: "faulted" });
    expect(await reopened.harness.snapshot(LiveDoc, reopened.root.id, context)).toEqual({});
    expect((await allEntries(reopened.root)).map((entry) => entry.kind)).toEqual([
      "msa.user",
      "msa.assistant",
    ]);
    await reopened.harness.close(context);
  });
});

// A stream whose final message is not strict JSON, so the classification commit throws and the task faults.
function invalidFinalStream(): ReturnType<Models["streamSimple"]> {
  const events = async function* () {
    yield { type: "start", partial: fauxAssistantMessage("partial", { stopReason: "pending" }) };
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
  };
  const final = { ...fauxAssistantMessage("final"), invalid: () => {} };
  return {
    [Symbol.asyncIterator]: events,
    result: () => Promise.resolve(final),
  } as unknown as ReturnType<Models["streamSimple"]>;
}
