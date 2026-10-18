import { rm } from "node:fs/promises";

import { createModels } from "@msa/ai";
import {
  AgentDoc,
  configure,
  defineExtension,
  defineTask,
  LiveDoc,
  ProviderDoc,
} from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { createSession } from "@msa/durable/session";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { directories, append, UUID_V7, NoteDoc } from "./harness-conversations-support.ts";
import { openHarness, tool, user } from "./harness-support.ts";
import { ControlledStorage, context } from "./session-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("Harness root and conversations", () => {
  it("binds commits and task creation to the conversation", async () => {
    const { harness } = await openHarness(new MemoryStorage());
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" } },
      context,
    );
    const task = defineTask<{ n: number }, { phase: "run" }, null>({
      name: "test.work",
      version: 1,
      initial: () => ({ phase: "run" }),
      phases: { run: async () => {} },
      abort: async () => {},
    });
    const taskId = await conversation.commit(
      (tx) => tx.createTask(task, { n: 1 }, { ownership: { kind: "conversation" } }),
      context,
    );
    const record = await harness.commit((tx) => tx.task(taskId), context);
    expect(record?.conversationId).toBe(conversation.id);
    await expect(
      harness.commit(
        (tx) => tx.createTask(task, { n: 2 }, { ownership: { kind: "conversation" } }),
        context,
      ),
    ).rejects.toThrow("requires options.conversationId");
    await harness.close(context);
  });
});

describe("Harness root and conversations", () => {
  it("runs conversationCreated in every creating commit, after the built-ins and before agent and init", async () => {
    const seen: string[] = [];
    const harness = await Harness.open(
      new MemoryStorage(),
      {
        models: createModels(),
        registry: createRegistry(),
        conversationCreated: async (tx, conversation) => {
          const agent = await tx.doc(AgentDoc, conversation.id);
          seen.push(
            `${conversation.id}:${conversation.parent === undefined ? "new" : "fork"}:${agent.cwd}`,
          );
          (await tx.doc(NoteDoc, conversation.id)).text ||= "created";
          if (agent.cwd === "/fail") throw new Error("no");
        },
      },
      context,
    );
    const root = await harness.root(context, {
      agent: { cwd: "/root" },
      init: async (tx, id) => void seen.push(`init:${(await tx.doc(NoteDoc, id)).text}`),
    });
    // A raw creation in a commit, as in a tool, and a fork, which already has the asOf copies.
    const raw = await harness.commit(
      async (tx) => (await tx.createConversation({ ownership: { kind: "ownerless" } })).id,
      context,
    );
    const entry = await append(root, "hello");
    const fork = await root.fork(entry.id, { ownership: { kind: "ownerless" } }, context);
    expect(seen).toEqual([
      `${root.id}:new:undefined`,
      "init:created",
      `${raw}:new:undefined`,
      `${fork.id}:fork:/root`,
    ]);
    expect(await harness.snapshot(NoteDoc, raw, context)).toEqual({ text: "created" });
    // A throw fails the creating commit.
    await root.configure({ cwd: "/fail" }, context);
    await expect(
      root.fork(entry.id, { ownership: { kind: "ownerless" } }, context),
    ).resolves.toBeDefined();
    const failing = await append(root, "after");
    await expect(
      root.fork(failing.id, { ownership: { kind: "ownerless" } }, context),
    ).rejects.toThrow("no");
    await harness.close(context);
  });
});

async function txCreatedConversations() {
  const { harness } = await openHarness(new MemoryStorage(), ["read"]);
  const root = await harness.root(context, {
    agent: {
      model: { provider: "faux", modelId: "m" },
      instructions: "Main role.",
      cwd: "/repo",
    },
  });
  const owner = defineTask<Record<string, never>, { phase: "never" }, null>({
    name: "test.owner",
    version: 1,
    initial: () => ({ phase: "never" }),
    phases: { never: async () => {} },
    abort: async () => {},
  });
  const ids = await root.commit(async (tx) => {
    const taskId = await tx.createTask(owner, {}, { ownership: { kind: "conversation" } });
    const plain = await tx.createConversation({ ownership: { kind: "ownerless" } });
    const owned = await tx.createConversation({ ownership: { kind: "task", taskId } });
    // The copy exists when createConversation() returns, so a configure() in the same callback overrides it.
    expect((await tx.doc(AgentDoc, owned.id)).cwd).toBe("/repo");
    await configure(tx, owned.id, { cwd: "/worktree" });
    return { taskId, plain: plain.id, owned: owned.id };
  }, context);
  return { harness, root, ids };
}

describe("Harness agent", () => {
  it("replaces whole fields, clears them with null, and leaves undefined fields alone", async () => {
    const { harness, registry } = await openHarness(new MemoryStorage());
    const read = tool("read");
    const bash = tool("bash");
    const edit = tool("edit");
    registry.install(defineExtension({ name: "coding", tools: [read, bash, edit] }));
    const root = await harness.root(context);
    const stored = () => harness.snapshot(AgentDoc, root.id, context);
    const offered = async () => (await root.agent(context)).tools.map((each) => each.name);
    expect(await root.agent(context)).toMatchObject({
      thinkingLevel: "off",
      tools: [read, bash, edit],
    });
    expect((await root.agent(context)).model).toBeUndefined();

    await root.configure(
      { model: { provider: "openai", modelId: "gpt" }, thinkingLevel: "medium" },
      context,
    );
    await root.configure({ model: undefined, instructions: "Be terse." }, context);
    expect(await stored()).toEqual({
      model: { provider: "openai", modelId: "gpt" },
      thinkingLevel: "medium",
      instructions: "Be terse.",
    });
    await root.configure({ model: null, instructions: null }, context);
    expect(await stored()).toEqual({ thinkingLevel: "medium" });

    await root.configure({ tools: { remove: [edit] } }, context);
    expect(await offered()).toEqual(["read", "bash"]);
    // A new filter replaces the old one: edit is offered again.
    await root.configure({ tools: { remove: [bash] } }, context);
    expect(await offered()).toEqual(["read", "edit"]);
    await root.configure({ tools: [edit, read] }, context);
    expect(await offered()).toEqual(["edit", "read"]);
    await root.configure({ tools: null }, context);
    expect(await offered()).toEqual(["read", "bash", "edit"]);
    // Names are stored without checking the registry.
    await root.configure({ tools: [tool("missing"), read] }, context);
    expect(await stored()).toMatchObject({ tools: ["missing", "read"] });
    expect(await offered()).toEqual(["read"]);
    await harness.close(context);
  });
});

describe("Harness agent", () => {
  it("gives conversations created through Tx their documents: empty, an owner copy, or the fork's as-of copy", async () => {
    const { harness, root, ids } = await txCreatedConversations();
    expect(await harness.snapshot(AgentDoc, ids.plain, context)).toEqual({});
    expect(await harness.snapshot(LiveDoc, ids.plain, context)).toEqual({});
    expect(await harness.snapshot(ProviderDoc, ids.plain, context)).toEqual({
      sessionId: expect.stringMatching(UUID_V7),
    });
    expect((await harness.snapshot(ProviderDoc, ids.owned, context))?.sessionId).not.toBe(
      (await harness.snapshot(ProviderDoc, root.id, context))?.sessionId,
    );
    expect(await harness.snapshot(AgentDoc, ids.owned, context)).toEqual({
      model: { provider: "faux", modelId: "m" },
      instructions: "Main role.",
      cwd: "/worktree",
    });

    // A later owner change does not reach the child.
    await root.configure({ thinkingLevel: "high" }, context);
    expect((await harness.snapshot(AgentDoc, ids.owned, context))?.thinkingLevel).toBeUndefined();

    // A task-owned fork keeps its as-of copy of its fork parent, not its owner's agent.
    const at = await root.commit(
      async (tx) => (await tx.appendEntry(ids.plain, { kind: "note" })).id,
      context,
    );
    const fork = await root.commit(
      async (tx) =>
        (
          await tx.forkConversation(ids.plain, at, {
            ownership: { kind: "task", taskId: ids.taskId },
          })
        ).id,
      context,
    );
    expect(await harness.snapshot(AgentDoc, fork, context)).toEqual({});
    expect(await harness.snapshot(LiveDoc, fork, context)).toEqual({});
    expect((await harness.snapshot(ProviderDoc, fork, context))?.sessionId).not.toBe(
      (await harness.snapshot(ProviderDoc, ids.plain, context))?.sessionId,
    );
    await harness.close(context);
  });
});

describe("Harness agent", () => {
  it("reads an absent agent for conversations a plain Session created without writing", async () => {
    const storage = new ControlledStorage();
    const id = await createSession(storage).commit(
      async (tx) => (await tx.createConversation({ ownership: { kind: "ownerless" } })).id,
      context,
    );
    const { harness } = await openHarness(storage, ["read"]);
    const raw = await harness.conversation(id, context);
    expect(await harness.snapshot(LiveDoc, id, context)).toBeUndefined();
    const commits = storage.commits.length;
    expect(await raw!.agent(context)).toMatchObject({
      thinkingLevel: "off",
      tools: [{ name: "read" }],
    });
    expect(storage.commits).toHaveLength(commits);
    await raw!.configure({ thinkingLevel: "low" }, context);
    expect(await harness.snapshot(AgentDoc, id, context)).toEqual({ thinkingLevel: "low" });
    await harness.close(context);
  });
});

describe("Harness lifecycle", () => {
  it("returns stateless handles and rejects operations after close", async () => {
    const { harness } = await openHarness(new MemoryStorage());
    const root = await harness.root(context);
    const again = await harness.root(context);
    expect(again).not.toBe(root);
    expect(again.id).toBe(root.id);
    await harness.close(context);
    await expect(harness.root(context)).rejects.toThrow("is closed");
    await expect(
      harness.createConversation({ ownership: { kind: "ownerless" } }, context),
    ).rejects.toThrow("is closed");
    await expect(harness.conversation(root.id, context)).rejects.toThrow("is closed");
  });

  it("forwards generic Session document APIs", async () => {
    const { harness } = await openHarness(new MemoryStorage());
    const root = await harness.root(context);
    const entry = await root.commit(async (tx) => {
      (await tx.doc(NoteDoc, root.id)).text = "first";
      return tx.appendEntry(root.id, { kind: "message", model: [user("m")] });
    }, context);
    await harness.commit(async (tx) => {
      (await tx.doc(NoteDoc, root.id)).text = "second";
    }, context);
    expect(await harness.snapshot(NoteDoc, root.id, context)).toEqual({ text: "second" });
    expect(await harness.snapshotAsOf(NoteDoc, root.id, entry.id, context)).toEqual({
      text: "first",
    });
    const state = await harness.documentState(NoteDoc, root.id, context);
    expect(state?.value).toEqual({ text: "second" });
    state?.dispose();
    await harness.close(context);
  });
});
