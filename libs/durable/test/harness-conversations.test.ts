import {
  AgentDoc,
  type Conversation,
  type ConversationId,
  LiveDoc,
  ProviderDoc,
  ROOT_CONVERSATION_ID,
} from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { awaited } from "./effect-support.ts";
import {
  directories,
  append,
  allEntries,
  UUID_V7,
  NoteDoc,
} from "./harness-conversations-support.ts";
import { addTool, openHarness, tool, user } from "./harness-support.ts";
import { joinPath, makeTempDir, removeDir } from "./platform-support.ts";
import { ControlledStorage, context } from "./session-support.ts";

const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-harness-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const closedConversations = Effect.fn("closedConversations")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const first = yield* openHarness(yield* awaited(openNodeSqliteStorage(path)), ["read"]);
  const root = yield* awaited(first.harness.root(context));
  yield* awaited(
    root.configure({ model: { provider: "anthropic", modelId: "claude" }, cwd: "/repo" }, context),
  );
  const entry = yield* awaited(append(root, "hello"));
  const child = yield* awaited(
    first.harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  const fork = yield* awaited(root.fork(entry.id, { ownership: { kind: "ownerless" } }, context));
  const providerSessionIds = yield* awaited(
    Promise.all(
      [root, child, fork].map((conversation) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(first.harness.snapshot(ProviderDoc, conversation.id, context)))
              ?.sessionId;
          }),
        ),
      ),
    ),
  );
  for (const sessionId of providerSessionIds) expect(sessionId).toMatch(UUID_V7);
  expect(new Set(providerSessionIds).size).toBe(3);
  yield* awaited(first.harness.close(context));
  yield* awaited(expect(root.agent(context)).rejects.toThrow());
  return { path, root, child, fork, providerSessionIds };
});

const createsRootLazilyStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  const { harness } = yield* openHarness(storage, ["read", "bash"]);
  expect(storage.commits).toHaveLength(0);
  const root = yield* awaited(
    harness.root(context, {
      agent: { thinkingLevel: "high" },
      init: (tx, id) =>
        runPromise(
          Effect.gen(function* () {
            expect((yield* awaited(tx.doc(AgentDoc, id))).thinkingLevel).toBe("high");
            (yield* awaited(tx.doc(NoteDoc, id))).text = "root note";
          }),
        ),
    }),
  );
  expect(root.id).toBe(ROOT_CONVERSATION_ID);
  expect(storage.commits).toHaveLength(1);
  expect(storage.commits[0]!.map((write) => write.type)).toEqual([
    "conversation",
    "document.create",
    "document.create",
    "document.create",
    "document.create",
    "document.create",
    "document.create",
  ]);
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  expect(yield* awaited(harness.snapshot(ProviderDoc, root.id, context))).toEqual({
    sessionId: expect.stringMatching(UUID_V7),
  });
  expect(yield* awaited(harness.snapshot(AgentDoc, root.id, context))).toEqual({
    thinkingLevel: "high",
  });
  const agent = yield* awaited(root.agent(context));
  expect(agent.thinkingLevel).toBe("high");
  expect(agent.tools.map((each) => each.name)).toEqual(["read", "bash"]);
  expect(yield* awaited(harness.snapshot(NoteDoc, root.id, context))).toEqual({
    text: "root note",
  });
  return { storage, harness, root };
});

const createsRootLazily = Effect.gen(function* () {
  const { storage, harness, root } = yield* createsRootLazilyStep1;
  const again = yield* awaited(
    harness.root(context, {
      agent: { thinkingLevel: "low" },
      init: () => expect.unreachable(),
    }),
  );
  expect(again.id).toBe(root.id);
  expect(storage.commits).toHaveLength(1);
  yield* awaited(harness.close(context));
});

describe("Harness root and conversations", () => {
  it("creates the root lazily with its agent change and init in one commit", () =>
    Effect.runPromise(createsRootLazily));
});

const keepsRootConversation = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { path, root, child, fork, providerSessionIds } = yield* closedConversations();

  const second = yield* openHarness(yield* awaited(openNodeSqliteStorage(path)), []);
  const reopened = yield* awaited(
    second.harness.root(context, { init: () => expect.unreachable() }),
  );
  expect(reopened.id).toBe(ROOT_CONVERSATION_ID);
  expect(yield* awaited(reopened.agent(context))).toMatchObject({
    model: { provider: "anthropic", modelId: "claude" },
    cwd: "/repo",
    tools: [],
  });
  expect(yield* allEntries(reopened)).toEqual(["hello"]);
  expect((yield* awaited(second.harness.conversation(child.id, context)))?.id).toBe(child.id);
  yield* awaited(
    expect(
      Promise.all(
        [root.id, child.id, fork.id].map((id) =>
          runPromise(
            Effect.gen(function* () {
              return (yield* awaited(second.harness.snapshot(ProviderDoc, id, context)))?.sessionId;
            }),
          ),
        ),
      ),
    ).resolves.toEqual(providerSessionIds),
  );
  const reopenedFork = yield* awaited(second.harness.conversation(fork.id, context));
  expect(yield* allEntries(reopenedFork!)).toEqual(["hello"]);
  expect((yield* awaited(reopenedFork!.agent(context))).model).toEqual({
    provider: "anthropic",
    modelId: "claude",
  });
  expect(
    yield* awaited(second.harness.conversation(999 as ConversationId, context)),
  ).toBeUndefined();
  yield* awaited(second.harness.close(context));
});

describe("Harness root and conversations", () => {
  it("keeps root and conversation identity and state across reopen", () =>
    Effect.runPromise(keepsRootConversation));
});

const createsIndependentConversationsStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  const { harness, registry } = yield* openHarness(storage, ["read"]);
  const created = yield* awaited(
    harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        init: (tx, id) =>
          runPromise(
            Effect.asVoid(
              Effect.suspend(() =>
                awaited(tx.appendEntry(id, { kind: "message", model: [user("seed")] })),
              ),
            ),
          ),
      },
      context,
    ),
  );
  expect(storage.commits).toHaveLength(1);
  expect(yield* allEntries(created)).toEqual(["seed"]);

  const before = storage.commits.length;
  yield* awaited(
    expect(
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
    ).rejects.toThrow("init failed"),
  );
  expect(storage.commits).toHaveLength(before);

  addTool(registry, tool("bash"));
  return { runPromise, harness, created };
});

const createsIndependentConversations = Effect.gen(function* () {
  const { runPromise, harness, created } = yield* createsIndependentConversationsStep1;
  const names = (conversation: Conversation) =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(conversation.agent(context))).tools.map((each) => each.name);
      }),
    );
  expect(yield* awaited(names(created))).toEqual(["read", "bash"]);
  yield* awaited(harness.close(context));
});

describe("Harness root and conversations", () => {
  it("creates independent conversations atomically with init and rolls back failures", () =>
    Effect.runPromise(createsIndependentConversations));
});
