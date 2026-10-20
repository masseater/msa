import durable from "@msa/durable";
import session from "@msa/durable/session";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessConversationsSupport from "./harness-conversations-support.ts";
import support from "./support.ts";

const { MemoryStorage } = memory;
const { AgentDoc, LiveDoc, ProviderDoc, configure, defineTask } = durable;
const { createSession } = session;

const { NoteDoc, UUID_V7, directories } = harnessConversationsSupport;
const { ControlledStorage, awaited, context, openHarness, removeDir, user } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const txCreatedConversations = Effect.fn("txCreatedConversations")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness } = yield* openHarness(new MemoryStorage(), ["read"]);
  const root = yield* awaited(
    harness.root(context, {
      agent: {
        cwd: "/repo",
        instructions: "Main role.",
        model: { modelId: "m", provider: "faux" },
      },
    }),
  );
  const owner = defineTask<Record<string, never>, { phase: "never" }, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "never" }),
    name: "test.owner",
    phases: { never: () => Promise.resolve() },
    version: 1,
  });
  const ids = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const taskId = yield* awaited(
              tx.createTask(owner, {}, { ownership: { kind: "conversation" } }),
            );
            const plain = yield* awaited(
              tx.createConversation({ ownership: { kind: "ownerless" } }),
            );
            const owned = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId } }),
            );
            expect((yield* awaited(tx.doc(AgentDoc, owned.id))).cwd).toBe("/repo");
            yield* awaited(configure(tx, owned.id, { cwd: "/worktree" }));
            return { owned: owned.id, plain: plain.id, taskId };
          }),
        ),
      context,
    ),
  );
  return { harness, ids, root };
});

const givesConversationsCreatedStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root, ids } = yield* txCreatedConversations();
  expect(yield* awaited(harness.snapshot(AgentDoc, ids.plain, context))).toEqual({});
  expect(yield* awaited(harness.snapshot(LiveDoc, ids.plain, context))).toEqual({});
  expect(yield* awaited(harness.snapshot(ProviderDoc, ids.plain, context))).toEqual({
    sessionId: expect.stringMatching(UUID_V7),
  });
  expect((yield* awaited(harness.snapshot(ProviderDoc, ids.owned, context)))?.sessionId).not.toBe(
    (yield* awaited(harness.snapshot(ProviderDoc, root.id, context)))?.sessionId,
  );
  expect(yield* awaited(harness.snapshot(AgentDoc, ids.owned, context))).toEqual({
    cwd: "/worktree",
    instructions: "Main role.",
    model: { modelId: "m", provider: "faux" },
  });

  yield* awaited(root.configure({ thinkingLevel: "high" }, context));
  expect(
    (yield* awaited(harness.snapshot(AgentDoc, ids.owned, context)))?.thinkingLevel,
  ).toBeUndefined();

  const at = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(tx.appendEntry(ids.plain, { kind: "note" }))).id;
          }),
        ),
      context,
    ),
  );
  return { at, harness, ids, root, runPromise };
});

const givesConversationsCreated = Effect.gen(function* () {
  const { runPromise, harness, root, ids, at } = yield* givesConversationsCreatedStep1;
  const fork = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(
              tx.forkConversation(ids.plain, at, {
                ownership: { kind: "task", taskId: ids.taskId },
              }),
            )).id;
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(harness.snapshot(AgentDoc, fork, context))).toEqual({});
  expect(yield* awaited(harness.snapshot(LiveDoc, fork, context))).toEqual({});
  expect((yield* awaited(harness.snapshot(ProviderDoc, fork, context)))?.sessionId).not.toBe(
    (yield* awaited(harness.snapshot(ProviderDoc, ids.plain, context)))?.sessionId,
  );
  yield* awaited(harness.close(context));
});

describe("Harness agent", () => {
  it("gives conversations created through Tx their documents: empty, an owner copy, or the fork's as-of copy", () =>
    Effect.runPromise(givesConversationsCreated));
});

const readsAbsentAgent = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  const id = yield* awaited(
    createSession(storage).commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(tx.createConversation({ ownership: { kind: "ownerless" } }))).id;
          }),
        ),
      context,
    ),
  );
  const { harness } = yield* openHarness(storage, ["read"]);
  const raw = yield* awaited(harness.conversation(id, context));
  expect(yield* awaited(harness.snapshot(LiveDoc, id, context))).toBeUndefined();
  const commits = storage.commits.length;
  expect(yield* awaited(raw!.agent(context))).toMatchObject({
    thinkingLevel: "off",
    tools: [{ name: "read" }],
  });
  expect(storage.commits).toHaveLength(commits);
  yield* awaited(raw!.configure({ thinkingLevel: "low" }, context));
  expect(yield* awaited(harness.snapshot(AgentDoc, id, context))).toEqual({
    thinkingLevel: "low",
  });
  yield* awaited(harness.close(context));
});

describe("Harness agent", () => {
  it("reads an absent agent for conversations a plain Session created without writing", () =>
    Effect.runPromise(readsAbsentAgent));
});

const returnsStatelessHandles = Effect.gen(function* () {
  const { harness } = yield* openHarness(new MemoryStorage());
  const root = yield* awaited(harness.root(context));
  const again = yield* awaited(harness.root(context));
  expect(again).not.toBe(root);
  expect(again.id).toBe(root.id);
  yield* awaited(harness.close(context));
  yield* awaited(expect(harness.root(context)).rejects.toThrow("is closed"));
  yield* awaited(
    expect(
      harness.createConversation({ ownership: { kind: "ownerless" } }, context),
    ).rejects.toThrow("is closed"),
  );
  yield* awaited(expect(harness.conversation(root.id, context)).rejects.toThrow("is closed"));
});

const forwardsGenericSession = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness } = yield* openHarness(new MemoryStorage());
  const root = yield* awaited(harness.root(context));
  const entry = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(NoteDoc, root.id))).text = "first";
            return yield* awaited(tx.appendEntry(root.id, { kind: "message", model: [user("m")] }));
          }),
        ),
      context,
    ),
  );
  yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(NoteDoc, root.id))).text = "second";
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(harness.snapshot(NoteDoc, root.id, context))).toEqual({
    text: "second",
  });
  expect(yield* awaited(harness.snapshotAsOf(NoteDoc, root.id, entry.id, context))).toEqual({
    text: "first",
  });
  const state = yield* awaited(harness.documentState(NoteDoc, root.id, context));
  expect(state?.value).toEqual({ text: "second" });
  state?.dispose();
  yield* awaited(harness.close(context));
});

describe("Harness lifecycle", () => {
  it("returns stateless handles and rejects operations after close", () =>
    Effect.runPromise(returnsStatelessHandles));

  it("forwards generic Session document APIs", () => Effect.runPromise(forwardsGenericSession));
});
