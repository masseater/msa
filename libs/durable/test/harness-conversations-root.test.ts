import { createModels } from "@msa/ai";
import { AgentDoc, defineExtension, defineTask } from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { directories, append, NoteDoc } from "./harness-conversations-support.ts";
import { awaited, openHarness, tool, removeDir, context } from "./support.ts";

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

const runsConversationCreatedEveryStep1 = Effect.gen(function* () {
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
  return { runPromise, seen, harness, root };
});

const runsConversationCreatedEvery = Effect.gen(function* () {
  const { runPromise, seen, harness, root } = yield* runsConversationCreatedEveryStep1;
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
