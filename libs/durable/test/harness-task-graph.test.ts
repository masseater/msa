import { join } from "node:path";

import type { JsonValue } from "@msa/chord";
import { applyImmutable, type Op } from "@msa/chord/delta";
import {
  type ConversationId,
  defineTask,
  type EntryId,
  type TaskGraph,
  type TaskId,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { statuses, family } from "./harness-task-graph-support.ts";
import { context, flush } from "./session-support.ts";
import { aborted, completed, deferred, eventually, openTasks } from "./task-support.ts";
import { makeTempDir, removeDir } from "./temp-support.ts";

type GraphHarness = Awaited<ReturnType<typeof openTasks>>["harness"];

// Observe the task graph, collecting every update. `rebuild` checks that the advanced value equals a fresh build from
// Storage once the last observer left.
async function observedGraph(harness: GraphHarness) {
  const seen: TaskGraph[] = [];
  const observe = async () => {
    const opened = await harness.taskGraph(context);
    opened.subscribe((value, _context, delivery) => {
      if (delivery.kind === "update") seen.push(value);
    });
    return opened;
  };
  const view = { graph: await observe() };
  const rebuild = async () => {
    const advanced = view.graph.value;
    view.graph.dispose();
    view.graph = await observe();
    expect(view.graph.value).not.toBe(advanced);
    expect(view.graph.value).toEqual(advanced);
  };
  const childId = (): string =>
    Object.values(view.graph.value.tasks)
      .find((node) => node.kind === "test.graph-child")
      ?.id.toString() ?? "";
  return { seen, view, rebuild, childId };
}

function expectPendingParent(graph: TaskGraph, parent: TaskId, conversationId: ConversationId) {
  expect(graph.tasks[String(parent)]).toEqual({
    id: parent,
    kind: "test.graph-parent",
    conversationId,
    background: false,
    abortRequested: false,
    state: { status: "pending", phase: "spawn" },
    conversations: [],
  });
}

// The parent waits on its first child and owns two conversations, listed in order.
function expectWaitingParent(
  graph: TaskGraph,
  parent: TaskId,
  conversationId: ConversationId,
  childId: string,
) {
  const first = Number(childId) as TaskId;
  const parentNode = graph.tasks[String(parent)]!;
  expect(parentNode.state).toEqual({
    status: "waiting",
    phase: "join",
    on: [first],
    policy: "allSettled",
  });
  expect(parentNode.conversations).toHaveLength(2);
  expect([...parentNode.conversations].sort((a, b) => a - b)).toEqual(parentNode.conversations);
  expect(graph.tasks[String(first)]).toMatchObject({ owner: parent, conversationId });
  return { first, parentNode };
}

function expectDistinctRevisions(seen: readonly TaskGraph[], parent: TaskId) {
  // Every revision is one commit that changed a node; none repeats its predecessor.
  for (let index = 1; index < seen.length; index++)
    expect(seen[index]).not.toEqual(seen[index - 1]);
  // The commit that created the two conversations published one revision setting them.
  expect(seen.some((value) => value.tasks[String(parent)]?.conversations.length === 2)).toBe(true);
}

async function committedGraphTasks() {
  const directory = await makeTempDir("msa-durable-graph-");
  const path = join(directory, "session.sqlite");
  const gate = deferred();
  const Work = defineTask<null, { phase: "work" }, null>({
    name: "test.graph-work",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: async (_task, runtime, ctx) => {
        await Promise.race([gate.promise, aborted(runtime.signal)]);
        await runtime.commit(() => completed(null), ctx);
      },
    },
    abort: async (_task, runtime, ctx) => {
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "aborted", reason: "test" } }),
        ctx,
      );
    },
  });
  const first = await openTasks(await openNodeSqliteStorage(path), [Work]);
  const firstRoot = await first.harness.root(context);
  const [foreground, background, owned] = await firstRoot.commit(async (tx) => {
    const foreground = await tx.createTask(Work, null, { ownership: { kind: "conversation" } });
    const background = await tx.createTask(Work, null, {
      ownership: { kind: "conversation" },
      background: true,
    });
    const owned = await tx.createConversation({
      ownership: { kind: "task", taskId: foreground },
    });
    return [foreground, background, owned.id] as const;
  }, context);
  first.harness.resume();
  await eventually(async () =>
    (await first.harness.inspect(context)).tasks.every((task) => task.state.kind === "running"),
  );
  const running = await first.harness.taskGraph(context);
  expect(statuses(running.value)).toEqual({
    [`test.graph-work#${foreground}`]: "running",
    [`test.graph-work#${background}`]: "running",
  });
  await first.harness.close(context);
  return { directory, path, gate, Work, foreground, background, owned };
}

describe("task graph view", () => {
  it("follows every live task through its statuses, owner edges, and owned conversations", async () => {
    const child = deferred();
    const late = deferred();
    const { Parent, Child } = family({ child: child.promise, late: late.promise });
    const { harness } = await openTasks(new MemoryStorage(), [Parent, Child]);
    const root = await harness.root(context);
    const { seen, view, rebuild, childId } = await observedGraph(harness);
    expect(view.graph.value).toEqual({ tasks: {} });

    const parent = await root.commit(
      (tx) => tx.createTask(Parent, null, { ownership: { kind: "conversation" } }),
      context,
    );
    await flush();
    expectPendingParent(view.graph.value, parent, root.id);

    harness.resume();
    await eventually(
      () =>
        Object.keys(view.graph.value.tasks).length === 2 &&
        statuses(view.graph.value)[`test.graph-child#${childId()}`] === "running",
    );
    const { first, parentNode } = expectWaitingParent(view.graph.value, parent, root.id, childId());
    expect((await harness.conversation(parentNode.conversations[0]!, context)) !== undefined).toBe(
      true,
    );
    await rebuild();

    child.resolve();
    // The parent completes while the late child lives: its outcome is held.
    await eventually(() => view.graph.value.tasks[String(parent)]?.state.status === "completing");
    expect(view.graph.value.tasks[String(parent)]!.state).toEqual({
      status: "completing",
      outcome: "completed",
    });
    expect(view.graph.value.tasks[String(first)]).toBeUndefined();
    // Owned conversations stay listed while the owner lives.
    expect(view.graph.value.tasks[String(parent)]!.conversations).toEqual(parentNode.conversations);
    await rebuild();

    late.resolve();
    await harness.waitForTask(parent, context);
    await flush();
    expect(view.graph.value).toEqual({ tasks: {} });
    expectDistinctRevisions(seen, parent);
    view.graph.dispose();
    await harness.close(context);
  });
});

describe("task graph view", () => {
  it("builds from committed tasks, shows surviving tasks as pending after reopen, and marks aborts", async () => {
    const { directory, path, gate, Work, foreground, background, owned } =
      await committedGraphTasks();

    // Acquired after reopen: built from the committed records and owner edges; open reconciled running to pending.
    const { harness } = await openTasks(await openNodeSqliteStorage(path), [Work]);
    const watch = await harness.watchTaskGraph(context);
    expect(statuses(watch.value)).toEqual({
      [`test.graph-work#${foreground}`]: "pending",
      [`test.graph-work#${background}`]: "pending",
    });
    expect(watch.value.tasks[String(foreground)]!.conversations).toEqual([owned as ConversationId]);
    expect(watch.value.tasks[String(background)]!.background).toBe(true);

    // Exact frames: replaying their operations from the acquisition revision gives each delivered value.
    const mirror: { replica: JsonValue } = { replica: watch.value as unknown as JsonValue };
    const frames: (readonly Op[])[] = [];
    watch.start((value, ops) => {
      mirror.replica = applyImmutable(mirror.replica, ops);
      expect(mirror.replica).toEqual(value);
      frames.push(ops);

      return Promise.resolve();
    });
    harness.resume();
    await eventually(() => watch.value.tasks[String(background)]?.state.status === "running");
    expect(await harness.abortTask(background, context)).toBe("marked");
    await harness.waitForTask(background, context);
    await flush();
    expect(frames).toContainEqual([
      ["s", ["tasks", String(background)], expect.objectContaining({ abortRequested: true })],
    ]);
    expect(frames.at(-1)).toEqual([["d", ["tasks", String(background)]]]);
    expect(Object.keys((mirror.replica as unknown as TaskGraph).tasks)).toEqual([
      String(foreground),
    ]);
    await watch.stop();
    gate.resolve();
    await harness.waitForTask(foreground, context);
    await harness.close(context);
    await removeDir(directory);
  });
});

describe("task graph view", () => {
  it("lists owned conversations in ID order whatever order one commit creates them in", async () => {
    const gate = deferred();
    const created: number[] = [];
    const Spawner = defineTask<{ at: EntryId }, { phase: "spawn" }, null>({
      name: "test.graph-spawner",
      version: 1,
      initial: () => ({ phase: "spawn" }),
      phases: {
        spawn: async (task, runtime, ctx) => {
          await runtime.commit(async (tx) => {
            const ownership = { kind: "task", taskId: task.id } as const;
            const [forked, fresh] = await Promise.all([
              tx.forkConversation(runtime.conversationId, task.input.at, { ownership }),
              tx.createConversation({ ownership }),
            ]);
            created.push(forked.id, fresh.id);
            return undefined;
          }, ctx);
          await gate.promise;
          await runtime.commit(() => completed(null), ctx);
        },
      },
      abort: async () => {},
    });
    const { harness } = await openTasks(new MemoryStorage(), [Spawner]);
    const root = await harness.root(context);
    const graph = await harness.taskGraph(context);
    const id = await root.commit(async (tx) => {
      const entry = await tx.appendEntry(root.id, { kind: "note" });
      return tx.createTask(Spawner, { at: entry.id }, { ownership: { kind: "conversation" } });
    }, context);
    harness.resume();
    await eventually(() => (graph.value.tasks[String(id)]?.conversations.length ?? 0) === 2);
    const advanced = graph.value;
    expect(advanced.tasks[String(id)]!.conversations).toEqual([...created].sort((a, b) => a - b));
    graph.dispose();
    const rebuilt = await harness.taskGraph(context);
    expect(rebuilt.value).toEqual(advanced);
    rebuilt.dispose();
    gate.resolve();
    await harness.waitForTask(id, context);
    await harness.close(context);
  });
});
