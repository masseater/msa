import { AgentDoc, defineEntry } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { directories, append, allEntries } from "./harness-conversations-support.ts";
import { addTool, openHarness, tool, user } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const Message = defineEntry("message");

const forksConcreteEntryStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, registry } = yield* openHarness(new MemoryStorage(), ["read"]);
  const legacy = tool("legacy");
  addTool(registry, legacy);
  const root = yield* awaited(harness.root(context));
  yield* awaited(root.configure({ thinkingLevel: "low" }, context));
  const at = yield* awaited(append(root, "one"));
  yield* awaited(root.configure({ thinkingLevel: "high", tools: [tool("read")] }, context));
  yield* awaited(append(root, "two"));

  const child = yield* awaited(root.fork(at.id, { ownership: { kind: "ownerless" } }, context));
  expect(yield* awaited(harness.snapshot(AgentDoc, child.id, context))).toEqual({
    thinkingLevel: "low",
  });
  expect(yield* allEntries(child)).toEqual(["one"]);

  const overridden = yield* awaited(
    root.fork(
      at.id,
      {
        ownership: { kind: "ownerless" },
        agent: { thinkingLevel: "minimal", tools: [legacy] },
        init: (tx, id) =>
          runPromise(
            Effect.gen(function* () {
              expect((yield* awaited(tx.doc(AgentDoc, id))).thinkingLevel).toBe("minimal");
            }),
          ),
      },
      context,
    ),
  );
  expect(yield* awaited(harness.snapshot(AgentDoc, overridden.id, context))).toEqual({
    thinkingLevel: "minimal",
    tools: ["legacy"],
  });
  expect(yield* awaited(harness.snapshot(AgentDoc, root.id, context))).toEqual({
    thinkingLevel: "high",
    tools: ["read"],
  });
  return { harness, root, at };
});

const forksConcreteEntry = Effect.gen(function* () {
  const { harness, root, at } = yield* forksConcreteEntryStep1;
  const unrelated = yield* awaited(
    harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  yield* awaited(
    expect(root.fork(at.id, { ownership: { kind: "ownerless" } }, context)).resolves.toBeDefined(),
  );
  yield* awaited(
    expect(unrelated.fork(at.id, { ownership: { kind: "ownerless" } }, context)).rejects.toThrow(
      "is not visible",
    ),
  );
  yield* awaited(harness.close(context));
});

describe("Harness root and conversations", () => {
  it("forks at a concrete entry with the as-of agent and applies agent and init overrides", () =>
    Effect.runPromise(forksConcreteEntry));
});

const paginatesForkAware = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness } = yield* openHarness(new MemoryStorage());
  const root = yield* awaited(harness.root(context));
  yield* awaited(append(root, "r1"));
  const [r2] = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return [
              yield* awaited(tx.appendEntry(root.id, { kind: "message", model: [user("r2")] })),
              yield* awaited(tx.appendEntry(root.id, { kind: "message", model: [user("r3")] })),
            ];
          }),
        ),
      context,
    ),
  );
  const child = yield* awaited(root.fork(r2!.id, { ownership: { kind: "ownerless" } }, context));
  const c1 = yield* awaited(append(child, "c1"));
  yield* awaited(append(child, "c2"));
  const grandchild = yield* awaited(
    child.fork(c1.id, { ownership: { kind: "ownerless" } }, context),
  );
  yield* awaited(append(grandchild, "g1"));

  expect(yield* allEntries(root)).toEqual(["r3", "r2", "r1"]);
  expect(yield* allEntries(child)).toEqual(["c2", "c1", "r2", "r1"]);
  expect(yield* allEntries(grandchild)).toEqual(["g1", "c1", "r2", "r1"]);
  expect(yield* allEntries(grandchild, "ascending")).toEqual(["r1", "r2", "c1", "g1"]);
  const bounded = yield* awaited(
    grandchild.entries(
      { minEntryId: r2!.id, maxEntryId: c1.id, conversationId: root.id } as never,
      10,
      undefined,
      context,
    ),
  );
  expect(bounded.items.map((entry) => entry.id)).toEqual([c1.id, r2!.id]);
  expect(Message.is(bounded.items[0])).toBe(true);
  expect(Message.is(undefined)).toBe(false);
  yield* awaited(harness.close(context));
});

describe("Harness root and conversations", () => {
  it("paginates fork-aware history through deep ancestor caps and same-commit prefixes", () =>
    Effect.runPromise(paginatesForkAware));
});
