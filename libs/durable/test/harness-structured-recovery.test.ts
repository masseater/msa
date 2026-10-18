import { rm } from "node:fs/promises";

import { fauxAssistantMessage, fauxText, type ToolResultMessage, Type } from "@msa/ai";
import { defineTool, LiveDoc, type TaskId, ToolResultEntry } from "@msa/durable";
import { createSession } from "@msa/durable/session";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, chatSetup, openChat } from "./chat-support.ts";
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
  spawn,
  directories,
  sqlitePath,
  toolCalls,
  blockingTool,
} from "./harness-structured-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";

afterEach(async () => {
  behaviors.clear();
  gates.clear();
  log.length = 0;
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

type Seeded = { parent: TaskId; children: TaskId[] };

// Write records a crash could leave, without a Harness: `parent` with children named `children`, then `edit` replaces
// states through the internal task write.
async function seed(
  path: string,
  children: readonly string[],
  edit: (set: (id: TaskId, patch: object) => Promise<void>, seeded: Seeded) => Promise<void>,
): Promise<Seeded> {
  const session = createSession(await openNodeSqliteStorage(path));
  const seeded = await session.commit(async (tx) => {
    const root = await tx.createConversation({ ownership: { kind: "ownerless" } });
    const parent = await tx.createTask(
      Node,
      { name: "parent" },
      { ...OWN_CONVERSATION, conversationId: root.id },
    );
    const ids: TaskId[] = [];
    for await (const name of children) ids.push(await spawn(tx, parent, name));
    return { parent, children: ids };
  }, context);
  await edit(async (id, patch) => {
    await session.commit(async (tx) => {
      const record = (await tx.task(id))!;
      (tx as unknown as { setTask(value: unknown): void }).setTask({ ...record, ...patch });
    }, context);
  }, seeded);
  await session.close(context);
  return seeded;
}

const COMPLETED = { status: "terminal", outcome: { status: "completed", result: "done" } };

const FAILED = {
  status: "terminal",
  outcome: { status: "failed", error: { message: "declined" } },
};

describe("recovery", () => {
  it("resumes a parent whose awaited children finished before the crash", async () => {
    const path = await sqlitePath();
    const { parent, children } = await seed(path, ["c1"], async (set, { parent, children }) => {
      await set(children[0]!, { state: COMPLETED });
      await set(parent, {
        state: {
          status: "waiting",
          checkpoint: { phase: "resume", round: 1 },
          on: children,
          policy: "allSettled",
        },
      });
    });
    const { harness } = await openNodes(await openNodeSqliteStorage(path));
    expect(await outcomeOf(harness, parent)).toBe("completed");
    expect(log).toEqual(["resume:parent"]);
    expect(children).toHaveLength(1);
    await harness.close(context);
  });

  it("marks failFast siblings a crash left unmarked", async () => {
    const path = await sqlitePath();
    const { parent, children } = await seed(
      path,
      ["c1", "c2"],
      async (set, { parent, children }) => {
        await set(children[0]!, { state: FAILED });
        await set(parent, {
          state: {
            status: "waiting",
            checkpoint: { phase: "resume", round: 1 },
            on: children,
            policy: "failFast",
          },
        });
      },
    );
    const { harness } = await openNodes(await openNodeSqliteStorage(path));
    expect(await outcomeOf(harness, children[1]!)).toBe("aborted");
    expect(await outcomeOf(harness, parent)).toBe("completed");
    expect(log).not.toContain("run:c2");
    await harness.close(context);
  });
});

describe("recovery", () => {
  it("finalizes a held outcome whose work drained before the crash, and keeps one whose work lives", async () => {
    const path = await sqlitePath();
    const held = { status: "completing", outcome: { status: "completed", result: "parent" } };
    const { parent, children } = await seed(path, ["c1"], async (set, { parent }) => {
      await set(parent, { state: held });
    });
    let opened = await openNodes(await openNodeSqliteStorage(path));
    await until(() => log.includes("run:c1"));
    expect(await state(opened.harness, parent)).toEqual(held);
    await opened.harness.close(context);

    opened = await openNodes(await openNodeSqliteStorage(path));
    open("c1");
    expect(await outcomeOf(opened.harness, children[0]!)).toBe("completed");
    expect(await outcomeOf(opened.harness, parent)).toBe("completed");
    await opened.harness.close(context);

    const drained = await sqlitePath();
    const second = await seed(drained, ["c1"], async (set, { parent, children }) => {
      await set(children[0]!, { state: COMPLETED });
      await set(parent, { state: held });
    });
    opened = await openNodes(await openNodeSqliteStorage(drained));
    expect(await outcomeOf(opened.harness, second.parent)).toBe("completed");
    await opened.harness.close(context);
  });

  it("resumes a bottom-up abort a crash interrupted before the cascade", async () => {
    const path = await sqlitePath();
    const { parent, children } = await seed(path, ["c1"], async (set, { parent, children }) => {
      await set(parent, {
        abortRequested: true,
        state: {
          status: "waiting",
          checkpoint: { phase: "resume", round: 1 },
          on: children,
          policy: "allSettled",
        },
      });
    });
    const { harness } = await openNodes(await openNodeSqliteStorage(path));
    expect(await outcomeOf(harness, parent)).toBe("aborted");
    expect(await outcomeOf(harness, children[0]!)).toBe("aborted");
    expect(log.filter((line) => line.startsWith("abort:"))).toEqual(["abort:c1", "abort:parent"]);
    await harness.close(context);
  });
});

describe("recovery", () => {
  it("reopens a checkout waiting on live payments and finishes it", async () => {
    const path = await sqlitePath();
    const found = parentOf("checkout", ["p1", "p2"], "failFast");
    let opened = await openNodes(await openNodeSqliteStorage(path));
    const parent = await start(opened.root, "checkout");
    await until(async () => (await state(opened.harness, parent)).status === "waiting");
    await until(() => log.includes("run:p1") && log.includes("run:p2"));
    await opened.harness.close(context);

    opened = await openNodes(await openNodeSqliteStorage(path));
    found.ids.splice(
      0,
      found.ids.length,
      ...((await state(opened.harness, parent)) as unknown as { on: TaskId<string>[] }).on,
    );
    open("p1");
    open("p2");
    expect(await outcomeOf(opened.harness, parent)).toBe("completed");
    expect(found.outcomes).toEqual(["completed", "completed"]);
    await opened.harness.close(context);
  });
});

describe("tool rounds", () => {
  it("owns its tool tasks, waits for them, and hands the run to a conversation-owned generation", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      defineTool({
        name: "noop",
        description: "Does nothing",
        parameters: Type.Object({}),
        execute: () => Promise.resolve({ output: [] }),
      }),
    );
    setup.faux.setResponses([
      toolCalls(["noop", "c1"], ["noop", "c2"]),
      fauxAssistantMessage([fauxText("done")]),
    ]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    expect(
      (await (await root.submit({ type: "input", content: "go" }, context)).wait(context)).status,
    ).toBe("done");
    const tasks = (
      await harness.commit((tx) => tx.scanTasks({ conversationId: root.id }, 20), context)
    ).items;
    const [first, second] = tasks.filter((task) => task.kind === "msa.generation");
    expect(tasks.filter((task) => task.kind === "msa.tool").map((task) => task.owner)).toEqual([
      first!.id,
      first!.id,
    ]);
    expect(first!.owner).toBeUndefined();
    expect(second!.owner).toBeUndefined();
    const assistant = (await allEntries(root)).find((entry) => entry.kind === "msa.assistant")!;
    expect(first!.state).toEqual({
      status: "terminal",
      outcome: { status: "completed", result: { entryId: assistant.id } },
    });
    await harness.close(context);
  });
});

describe("tool rounds", () => {
  it("aborts a parallel round with its generation: tools first, then the generation, with every result written", async () => {
    const setup = chatSetup();
    const one = blockingTool("one");
    const two = blockingTool("two");
    addTool(setup.registry, defineTool({ ...one.registration, executionMode: "parallel" }));
    addTool(setup.registry, defineTool({ ...two.registration, executionMode: "parallel" }));
    setup.faux.setResponses([toolCalls(["one", "c1"], ["two", "c2"])]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await Promise.all([one.started, two.started]);
    const generation = (await harness.snapshot(LiveDoc, root.id, context))!.run!.taskId;
    await harness.abortTask(generation, context);
    expect(await submission.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
    const results = (await allEntries(root)).filter((entry) => ToolResultEntry.is(entry));
    expect(results.map((entry) => (entry.model![0] as ToolResultMessage).toolCallId)).toEqual([
      "c1",
      "c2",
    ]);
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    expect((await harness.waitForTask(generation, context)).state.outcome.status).toBe("aborted");
    await harness.close(context);
  });
});
