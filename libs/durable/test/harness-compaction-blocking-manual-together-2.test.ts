import { type AgentEvent, LiveDoc } from "@msa/durable";
import { CompactionTask, watchEvents } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const { BLOCKING, directories, history, kinds, live, open, script, sqlitePath, text, turn } =
  harnessCompactionSupport;
const { addSection, awaited, chatSetup, context, openChat, removeDir, waitFor } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const sendsRequestBlocking = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  yield* history(chat);
  chat.setup.settings.compaction = BLOCKING;
  let changed = false;
  addSection(chat.setup.registry, "policy", () => {
    if (!changed) {
      changed = true;
      chat.setup.settings.compaction = { ...BLOCKING, keepRecentTokens: 100_000 };
    }
    return Promise.resolve("p");
  });
  yield* turn(chat, text("u4", 200), "a4");
  const compactions = (yield* awaited(chat.harness.inspect(context))).tasks.filter(
    (task) => task.record.kind === "msa.compaction",
  );
  expect(compactions).toEqual([]);
  expect(chat.faux.summaryRequests).toHaveLength(0);
  expect((yield* kinds(chat.root)).includes("msa.compaction")).toBe(false);
  yield* awaited(chat.harness.close(context));
});

describe("compaction pinning, silent overflow, and late policy changes", () => {
  it("sends the request when a blocking compaction finds nothing under a policy changed after preparation", () =>
    Effect.runPromise(sendsRequestBlocking));
});

const survivesReopenBlockedStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  let { harness, root } = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  const newer = {
    definition: { ...CompactionTask.definition, version: 2 },
  } as typeof CompactionTask;
  const id = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const taskId = yield* awaited(
              tx.createTask(newer, { reason: "manual" }, { ownership: { kind: "conversation" } }),
            );
            const liveInner = yield* awaited(tx.doc(LiveDoc, root.id));
            liveInner.compactions = [{ attempt: 1, blocking: false, reason: "manual", taskId }];
            return taskId;
          }),
        ),
      context,
    ),
  );
  yield* awaited(harness.close(context));
  ({ harness, root } = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup));
  harness.resume();
  const chat = { faux: script(setup), harness, root, setup };
  const events: AgentEvent[] = [];
  const stream = yield* awaited(watchEvents(chat.harness, chat.root.id, context));
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  const inspection = yield* awaited(chat.harness.inspect(context));
  expect(inspection.tasks.find((task) => task.record.id === id)?.state).toEqual({
    kind: "blocked",
    reason: "task_too_old",
  });
  yield* awaited(chat.harness.abortTask(id, context));
  return { chat, events, id, stream };
});

const survivesReopenBlocked = Effect.gen(function* () {
  const { id, chat, events, stream } = yield* survivesReopenBlockedStep1;
  expect((yield* awaited(chat.harness.waitForTask(id, context))).state.outcome).toEqual({
    reason: "task_too_old",
    status: "orphaned",
  });
  expect((yield* awaited(live(chat))).compactions).toBeUndefined();
  yield* waitFor(() => events.some((event) => event.type === "compaction_end"));
  yield* awaited(stream.stop());
  yield* awaited(chat.harness.close(context));
});

describe("blocked compaction", () => {
  it("survives reopen blocked and is orphaned on abort with its status removed", () =>
    Effect.runPromise(survivesReopenBlocked));
});
