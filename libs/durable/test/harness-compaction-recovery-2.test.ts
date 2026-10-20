import { CompactionTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const {
  BLOCKING,
  MANUAL,
  answer,
  directories,
  failure,
  gated,
  history,
  open,
  result,
  summary,
  text,
  turn,
  user,
  userText,
} = harnessCompactionSupport;
const { addHooks, allEntries, awaited, context, deferred, removeDir, waitFor } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const keepsFullRetry = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  chat.setup.settings.compaction = { ...MANUAL, enabled: true };
  chat.faux.summaries.push(summary());
  chat.faux.agent.push(
    failure("prompt is too long"),
    failure("overloaded"),
    failure("overloaded"),
    answer("finally"),
  );
  const input = yield* awaited(
    chat.root.submit({ content: text("u4", 100), type: "input" }, context),
  );
  expect((yield* awaited(input.wait(context))).status).toBe("done");
  yield* awaited(chat.harness.close(context));
});

const losesApplicationEdit = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const [u1] = yield* allEntries(chat.root);
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary(), reached));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  const edit = { action: "replace", messages: [user("REDACTED")], target: u1!.id } as const;
  yield* awaited(
    chat.root.submit({ entry: { edits: [edit], kind: "app.redact" }, type: "write" }, context),
  );
  gate.resolve();
  yield* awaited(result(chat, id));
  expect(userText(chat.faux.summaryRequests[0]!.messages[1])).toContain("[User]: u1 ");
  expect((yield* awaited(chat.root.context(context))).messages.map(userText)).not.toContain(
    "REDACTED",
  );
  yield* awaited(chat.harness.close(context));
});

describe("compaction and the inbox", () => {
  it("keeps the full retry budget after an overflow compaction", () =>
    Effect.runPromise(keepsFullRetry));

  it("loses an application edit placed while a compaction summarizes (spec §12)", () =>
    Effect.runPromise(losesApplicationEdit));
});

const keepsKeptEntries = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const state = yield* awaited(chat.root.viewState(context));
  chat.faux.summaries.push(summary());
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  yield* waitFor(() => state.value.entries[0]?.kind === "msa.compaction");
  expect(state.value.entries).toEqual((yield* awaited(chat.root.context(context))).entries);
  state.dispose();
  yield* awaited(chat.harness.close(context));
});

describe("compaction and the inbox", () => {
  it("keeps the kept entries mounted in the conversation view", () =>
    Effect.runPromise(keepsKeptEntries));
});

const keepsOneCompaction = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  yield* history(chat);
  chat.setup.settings.compaction = BLOCKING;
  let asked = 0;
  addHooks(chat.setup.registry, CompactionTask, {
    beforeCompact: () => {
      asked++;
      return { decline: true };
    },
  });
  chat.faux.agent.push(failure("overloaded"));
  yield* turn(chat, text("u4", 200), "a4");
  expect(asked).toBe(1);
  expect(chat.faux.agentRequests).toHaveLength(5);
  yield* awaited(chat.harness.close(context));
});

describe("compaction edge cases", () => {
  it("keeps the one-compaction limit through a retry backoff", () =>
    Effect.runPromise(keepsOneCompaction));
});
