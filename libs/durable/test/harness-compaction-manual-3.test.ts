import { type Message } from "@msa/ai";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const { MemoryStorage } = memory;
const { CompactionTask } = harnessModule;

const {
  MANUAL,
  directories,
  firstUserText,
  gated,
  history,
  live,
  open,
  result,
  script,
  summary,
  text,
  turn,
  userText,
} = harnessCompactionSupport;
const { addHooks, awaited, chatSetup, context, deferred, openChat, removeDir, waitFor } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const ordinaryWorkIdle = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary(), reached));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  let idle = false;
  const wait = chat.root.waitForIdle(context).then(() => {
    idle = true;
    return undefined;
  });
  yield* Effect.sleep(20);
  expect(idle).toBe(false);
  gate.resolve();
  yield* awaited(wait);
  expect((yield* awaited(chat.harness.getTask(id, context)))?.state.status).toBe("terminal");
  yield* awaited(chat.harness.close(context));
});

const enablesSchedulingRight = Effect.gen(function* () {
  const setup = chatSetup();
  const faux = script(setup);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  setup.settings.compaction = { ...MANUAL, keepRecentTokens: 10 };
  const id = yield* awaited(root.compact(undefined, context));
  yield* waitFor(
    Effect.gen(function* () {
      return (yield* awaited(harness.getTask(id, context)))?.state.status === "terminal";
    }),
  );
  expect((yield* awaited(harness.getTask(id, context)))?.state).toMatchObject({
    outcome: { result: {}, status: "completed" },
  });
  expect(faux.summaryRequests).toHaveLength(0);
  yield* awaited(harness.close(context));
});

describe("manual compaction", () => {
  it("is ordinary work: idle waits include it", () => Effect.runPromise(ordinaryWorkIdle));

  it("enables scheduling right after open", () => Effect.runPromise(enablesSchedulingRight));
});

const completesWithoutSummary = Effect.gen(function* () {
  const chat = yield* open();
  yield* turn(chat, "hi", "hello");
  const outcome = yield* awaited(
    result(chat, yield* awaited(chat.root.compact(undefined, context))),
  );
  expect(outcome).toEqual({ result: {}, status: "completed" });
  expect(chat.faux.summaryRequests).toHaveLength(0);
  expect((yield* awaited(live(chat))).compactions).toBeUndefined();
  yield* awaited(chat.harness.close(context));
});

describe("compaction outcomes", () => {
  it("completes without a summary when there is nothing to compact", () =>
    Effect.runPromise(completesWithoutSummary));
});

const asksBeforeCompactFirst = Effect.gen(function* () {
  const chat = yield* open();
  const seen: unknown[] = [];
  addHooks(chat.setup.registry, CompactionTask, {
    beforeCompact: () => {
      throw new Error("hook broke");
    },
  });
  addHooks(chat.setup.registry, CompactionTask, {
    beforeCompact: (compaction) => {
      seen.push(compaction);
      return { summary: "FROM HOOK" };
    },
  });
  addHooks(chat.setup.registry, CompactionTask, { beforeCompact: () => ({ decline: true }) });
  yield* history(chat);
  const outcome = yield* awaited(result(chat, yield* awaited(chat.root.compact("why", context))));
  expect(outcome.status).toBe("completed");
  expect(chat.faux.summaryRequests).toHaveLength(0);
  expect(firstUserText((yield* awaited(chat.root.context(context))).messages)).toContain(
    "<summary>\nFROM HOOK\n</summary>",
  );
  expect(chat.setup.reports).toEqual([expect.objectContaining({ message: "hook broke" })]);
  const compaction = seen[0] as {
    entries: durableTypes.EntryRecord[];
    messages: Message[];
    firstKept: number;
  };
  expect(compaction).toMatchObject({ instructions: "why", reason: "manual" });
  expect(compaction.entries.map((record) => record.kind)).toEqual([
    "msa.user",
    "msa.system",
    "msa.assistant",
    "msa.user",
    "msa.assistant",
  ]);
  expect(compaction.messages.filter((message) => message.role !== "system").map(userText)).toEqual([
    text("u1", 100),
    text("a1", 100),
    text("u2", 100),
    text("a2", 100),
  ]);
  yield* awaited(chat.harness.close(context));
});

describe("compaction outcomes", () => {
  it("asks beforeCompact: the first decision wins, a throw is reported and skipped", () =>
    Effect.runPromise(asksBeforeCompactFirst));
});
