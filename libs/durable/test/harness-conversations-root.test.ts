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
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { directories, append, UUID_V7, NoteDoc } from "./harness-conversations-support.ts";
import { openHarness, tool, user } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
import { ControlledStorage, context } from "./session-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const bindsCommitsTask = Effect.gen(function* () {
  const { harness } = yield* openHarness(new MemoryStorage());
  const conversation = yield* awaited(
    harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  const task = defineTask<{ n: number }, { phase: "run" }, null>({
    name: "test.work",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: { run: () => Promise.resolve() },
    abort: () => Promise.resolve(),
  });
  const taskId = yield* awaited(
    conversation.commit(
      (tx) => tx.createTask(task, { n: 1 }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  const record = yield* awaited(harness.commit((tx) => tx.task(taskId), context));
  expect(record?.conversationId).toBe(conversation.id);
  yield* awaited(
    expect(
      harness.commit(
        (tx) => tx.createTask(task, { n: 2 }, { ownership: { kind: "conversation" } }),
        context,
      ),
    ).rejects.toThrow("requires options.conversationId"),
  );
  yield* awaited(harness.close(context));
});

describe("Harness root and conversations", () => {
  it("binds commits and task creation to the conversation", () =>
    Effect.runPromise(bindsCommitsTask));
});

const runsConversationCreatedEvery = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const seen: string[] = [];
  const harness = yield* awaited(
    Harness.open(
      new MemoryStorage(),
      {
        models: createModels(),
        registry: createRegistry(),
        conversationCreated: (tx, conversation) =>
          runPromise(
            Effect.gen(function* () {
              const agent = yield* awaited(tx.doc(AgentDoc, conversation.id));
              seen.push(
                `${conversation.id}:${conversation.parent === undefined ? "new" : "fork"}:${agent.cwd}`,
              );
              (yield* awaited(tx.doc(NoteDoc, conversation.id))).text ||= "created";
              if (agent.cwd === "/fail") throw new Error("no");
            }),
          ),
      },
      context,
    ),
  );
  const root = yield* awaited(
    harness.root(context, {
      agent: { cwd: "/root" },
      init: (tx, id) =>
        runPromise(
          Effect.gen(function* () {
            return void seen.push(`init:${(yield* awaited(tx.doc(NoteDoc, id))).text}`);
          }),
        ),
    }),
  );
  const raw = yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(tx.createConversation({ ownership: { kind: "ownerless" } }))).id;
          }),
        ),
      context,
    ),
  );
  const entry = yield* awaited(append(root, "hello"));
  const fork = yield* awaited(root.fork(entry.id, { ownership: { kind: "ownerless" } }, context));
  expect(seen).toEqual([
    `${root.id}:new:undefined`,
    "init:created",
    `${raw}:new:undefined`,
    `${fork.id}:fork:/root`,
  ]);
  expect(yield* awaited(harness.snapshot(NoteDoc, raw, context))).toEqual({
    text: "created",
  });
  yield* awaited(root.configure({ cwd: "/fail" }, context));
  yield* awaited(
    expect(
      root.fork(entry.id, { ownership: { kind: "ownerless" } }, context),
    ).resolves.toBeDefined(),
  );
  const failing = yield* awaited(append(root, "after"));
  yield* awaited(
    expect(root.fork(failing.id, { ownership: { kind: "ownerless" } }, context)).rejects.toThrow(
      "no",
    ),
  );
  yield* awaited(harness.close(context));
});

describe("Harness root and conversations", () => {
  it("runs conversationCreated in every creating commit, after the built-ins and before agent and init", () =>
    Effect.runPromise(runsConversationCreatedEvery));
});

const txCreatedConversations = Effect.fn("txCreatedConversations")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness } = yield* openHarness(new MemoryStorage(), ["read"]);
  const root = yield* awaited(
    harness.root(context, {
      agent: {
        model: { provider: "faux", modelId: "m" },
        instructions: "Main role.",
        cwd: "/repo",
      },
    }),
  );
  const owner = defineTask<Record<string, never>, { phase: "never" }, null>({
    name: "test.owner",
    version: 1,
    initial: () => ({ phase: "never" }),
    phases: { never: () => Promise.resolve() },
    abort: () => Promise.resolve(),
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
            return { taskId, plain: plain.id, owned: owned.id };
          }),
        ),
      context,
    ),
  );
  return { harness, root, ids };
});

const replacesWholeFields = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, registry } = yield* openHarness(new MemoryStorage());
  const read = tool("read");
  const bash = tool("bash");
  const edit = tool("edit");
  registry.install(defineExtension({ name: "coding", tools: [read, bash, edit] }));
  const root = yield* awaited(harness.root(context));
  const stored = () => harness.snapshot(AgentDoc, root.id, context);
  const offered = () =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(root.agent(context))).tools.map((each) => each.name);
      }),
    );
  expect(yield* awaited(root.agent(context))).toMatchObject({
    thinkingLevel: "off",
    tools: [read, bash, edit],
  });
  expect((yield* awaited(root.agent(context))).model).toBeUndefined();

  yield* awaited(
    root.configure(
      { model: { provider: "openai", modelId: "gpt" }, thinkingLevel: "medium" },
      context,
    ),
  );
  yield* awaited(root.configure({ model: undefined, instructions: "Be terse." }, context));
  expect(yield* awaited(stored())).toEqual({
    model: { provider: "openai", modelId: "gpt" },
    thinkingLevel: "medium",
    instructions: "Be terse.",
  });
  yield* awaited(root.configure({ model: null, instructions: null }, context));
  expect(yield* awaited(stored())).toEqual({ thinkingLevel: "medium" });

  yield* awaited(root.configure({ tools: { remove: [edit] } }, context));
  expect(yield* awaited(offered())).toEqual(["read", "bash"]);
  yield* awaited(root.configure({ tools: { remove: [bash] } }, context));
  expect(yield* awaited(offered())).toEqual(["read", "edit"]);
  yield* awaited(root.configure({ tools: [edit, read] }, context));
  expect(yield* awaited(offered())).toEqual(["edit", "read"]);
  yield* awaited(root.configure({ tools: null }, context));
  expect(yield* awaited(offered())).toEqual(["read", "bash", "edit"]);
  yield* awaited(root.configure({ tools: [tool("missing"), read] }, context));
  expect(yield* awaited(stored())).toMatchObject({ tools: ["missing", "read"] });
  expect(yield* awaited(offered())).toEqual(["read"]);
  yield* awaited(harness.close(context));
});

describe("Harness agent", () => {
  it("replaces whole fields, clears them with null, and leaves undefined fields alone", () =>
    Effect.runPromise(replacesWholeFields));
});

const givesConversationsCreated = Effect.gen(function* () {
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
    model: { provider: "faux", modelId: "m" },
    instructions: "Main role.",
    cwd: "/worktree",
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
