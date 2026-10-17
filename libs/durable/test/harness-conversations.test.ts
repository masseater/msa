import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentDoc,
  type Conversation,
  type ConversationId,
  defineEntry,
  LiveDoc,
  MemoryStorage,
  ProviderDoc,
  ROOT_CONVERSATION_ID,
} from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import {
  directories,
  append,
  allEntries,
  UUID_V7,
  NoteDoc,
} from "./harness-conversations-support.ts";
import { addTool, openHarness, tool, user } from "./harness-support.ts";
import { ControlledStorage, context } from "./session-support.ts";

async function sqlitePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msa-durable-harness-"));
  directories.add(directory);
  return join(directory, "session.sqlite");
}

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

const Message = defineEntry("message");

async function closedConversations() {
  const path = await sqlitePath();
  const first = await openHarness(await openNodeSqliteStorage(path), ["read"]);
  const root = await first.harness.root(context);
  await root.configure(
    { model: { provider: "anthropic", modelId: "claude" }, cwd: "/repo" },
    context,
  );
  const entry = await append(root, "hello");
  const child = await first.harness.createConversation(
    { ownership: { kind: "ownerless" } },
    context,
  );
  const fork = await root.fork(entry.id, { ownership: { kind: "ownerless" } }, context);
  const providerSessionIds = await Promise.all(
    [root, child, fork].map(
      async (conversation) =>
        (await first.harness.snapshot(ProviderDoc, conversation.id, context))?.sessionId,
    ),
  );
  // Regression coverage for #10424: a fork must not inherit its parent's provider identity.
  for (const sessionId of providerSessionIds) expect(sessionId).toMatch(UUID_V7);
  expect(new Set(providerSessionIds).size).toBe(3);
  await first.harness.close(context);
  await expect(root.agent(context)).rejects.toThrow();
  return { path, root, child, fork, providerSessionIds };
}

describe("Harness root and conversations", () => {
  it("creates the root lazily with its agent change and init in one commit", async () => {
    const storage = new ControlledStorage();
    const { harness } = await openHarness(storage, ["read", "bash"]);
    expect(storage.commits).toHaveLength(0);
    const root = await harness.root(context, {
      agent: { thinkingLevel: "high" },
      init: async (tx, id) => {
        // The agent change applied before init.
        expect((await tx.doc(AgentDoc, id)).thinkingLevel).toBe("high");
        (await tx.doc(NoteDoc, id)).text = "root note";
      },
    });
    expect(root.id).toBe(ROOT_CONVERSATION_ID);
    expect(storage.commits).toHaveLength(1);
    // Conversation, five built-in documents, and the init note.
    expect(storage.commits[0]!.map((write) => write.type)).toEqual([
      "conversation",
      "document.create",
      "document.create",
      "document.create",
      "document.create",
      "document.create",
      "document.create",
    ]);
    expect(await harness.snapshot(LiveDoc, root.id, context)).toEqual({});
    expect(await harness.snapshot(ProviderDoc, root.id, context)).toEqual({
      sessionId: expect.stringMatching(UUID_V7),
    });
    expect(await harness.snapshot(AgentDoc, root.id, context)).toEqual({ thinkingLevel: "high" });
    const agent = await root.agent(context);
    expect(agent.thinkingLevel).toBe("high");
    expect(agent.tools.map((each) => each.name)).toEqual(["read", "bash"]);
    expect(await harness.snapshot(NoteDoc, root.id, context)).toEqual({ text: "root note" });

    const again = await harness.root(context, {
      agent: { thinkingLevel: "low" },
      init: () => expect.unreachable(),
    });
    expect(again.id).toBe(root.id);
    expect(storage.commits).toHaveLength(1);
    await harness.close(context);
  });
});

describe("Harness root and conversations", () => {
  it("keeps root and conversation identity and state across reopen", async () => {
    const { path, root, child, fork, providerSessionIds } = await closedConversations();

    // The new process installs nothing: the stored choices survive, the tools do not resolve.
    const second = await openHarness(await openNodeSqliteStorage(path), []);
    const reopened = await second.harness.root(context, { init: () => expect.unreachable() });
    expect(reopened.id).toBe(ROOT_CONVERSATION_ID);
    expect(await reopened.agent(context)).toMatchObject({
      model: { provider: "anthropic", modelId: "claude" },
      cwd: "/repo",
      tools: [],
    });
    expect(await allEntries(reopened)).toEqual(["hello"]);
    expect((await second.harness.conversation(child.id, context))?.id).toBe(child.id);
    await expect(
      Promise.all(
        [root.id, child.id, fork.id].map(
          async (id) => (await second.harness.snapshot(ProviderDoc, id, context))?.sessionId,
        ),
      ),
    ).resolves.toEqual(providerSessionIds);
    const reopenedFork = await second.harness.conversation(fork.id, context);
    expect(await allEntries(reopenedFork!)).toEqual(["hello"]);
    expect((await reopenedFork!.agent(context)).model).toEqual({
      provider: "anthropic",
      modelId: "claude",
    });
    expect(await second.harness.conversation(999 as ConversationId, context)).toBeUndefined();
    await second.harness.close(context);
  });
});

describe("Harness root and conversations", () => {
  it("creates independent conversations atomically with init and rolls back failures", async () => {
    const storage = new ControlledStorage();
    const { harness, registry } = await openHarness(storage, ["read"]);
    const created = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        init: async (tx, id) => {
          await tx.appendEntry(id, { kind: "message", model: [user("seed")] });
        },
      },
      context,
    );
    expect(storage.commits).toHaveLength(1);
    expect(await allEntries(created)).toEqual(["seed"]);

    const before = storage.commits.length;
    await expect(
      harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          agent: { thinkingLevel: "high" },
          init: () => {
            throw new Error("init failed");
          },
        },
        context,
      ),
    ).rejects.toThrow("init failed");
    expect(storage.commits).toHaveLength(before);

    // A conversation on the default selection follows installs live.
    addTool(registry, tool("bash"));
    const names = async (conversation: Conversation) =>
      (await conversation.agent(context)).tools.map((each) => each.name);
    expect(await names(created)).toEqual(["read", "bash"]);
    await harness.close(context);
  });
});

describe("Harness root and conversations", () => {
  it("forks at a concrete entry with the as-of agent and applies agent and init overrides", async () => {
    const { harness, registry } = await openHarness(new MemoryStorage(), ["read"]);
    const legacy = tool("legacy");
    addTool(registry, legacy);
    const root = await harness.root(context);
    await root.configure({ thinkingLevel: "low" }, context);
    const at = await append(root, "one");
    await root.configure({ thinkingLevel: "high", tools: [tool("read")] }, context);
    await append(root, "two");

    const child = await root.fork(at.id, { ownership: { kind: "ownerless" } }, context);
    expect(await harness.snapshot(AgentDoc, child.id, context)).toEqual({ thinkingLevel: "low" });
    expect(await allEntries(child)).toEqual(["one"]);

    const overridden = await root.fork(
      at.id,
      {
        ownership: { kind: "ownerless" },
        agent: { thinkingLevel: "minimal", tools: [legacy] },
        init: async (tx, id) => {
          expect((await tx.doc(AgentDoc, id)).thinkingLevel).toBe("minimal");
        },
      },
      context,
    );
    expect(await harness.snapshot(AgentDoc, overridden.id, context)).toEqual({
      thinkingLevel: "minimal",
      tools: ["legacy"],
    });
    expect(await harness.snapshot(AgentDoc, root.id, context)).toEqual({
      thinkingLevel: "high",
      tools: ["read"],
    });

    const unrelated = await harness.createConversation(
      { ownership: { kind: "ownerless" } },
      context,
    );
    await expect(
      root.fork(at.id, { ownership: { kind: "ownerless" } }, context),
    ).resolves.toBeDefined();
    await expect(
      unrelated.fork(at.id, { ownership: { kind: "ownerless" } }, context),
    ).rejects.toThrow("is not visible");
    await harness.close(context);
  });
});

describe("Harness root and conversations", () => {
  it("paginates fork-aware history through deep ancestor caps and same-commit prefixes", async () => {
    const { harness } = await openHarness(new MemoryStorage());
    const root = await harness.root(context);
    await append(root, "r1");
    const [r2] = await root.commit(
      async (tx) => [
        await tx.appendEntry(root.id, { kind: "message", model: [user("r2")] }),
        await tx.appendEntry(root.id, { kind: "message", model: [user("r3")] }),
      ],
      context,
    );
    const child = await root.fork(r2!.id, { ownership: { kind: "ownerless" } }, context);
    const c1 = await append(child, "c1");
    await append(child, "c2");
    const grandchild = await child.fork(c1.id, { ownership: { kind: "ownerless" } }, context);
    await append(grandchild, "g1");

    expect(await allEntries(root)).toEqual(["r3", "r2", "r1"]);
    expect(await allEntries(child)).toEqual(["c2", "c1", "r2", "r1"]);
    expect(await allEntries(grandchild)).toEqual(["g1", "c1", "r2", "r1"]);
    // #10546
    expect(await allEntries(grandchild, "ascending")).toEqual(["r1", "r2", "c1", "g1"]);
    const bounded = await grandchild.entries(
      { minEntryId: r2!.id, maxEntryId: c1.id, conversationId: root.id } as never,
      10,
      undefined,
      context,
    );
    expect(bounded.items.map((entry) => entry.id)).toEqual([c1.id, r2!.id]);
    expect(Message.is(bounded.items[0])).toBe(true);
    expect(Message.is(undefined)).toBe(false);
    await harness.close(context);
  });
});
