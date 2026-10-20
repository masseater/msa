import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessCompactionSupport from "./harness-compaction-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { MANUAL, directories, open, result, summary, user, userText } = harnessCompactionSupport;
const { removeDir } = platformSupport;
const { context } = sessionSupport;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const applyEditsCarriedStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = yield* open();
  const ids = yield* awaited(
    chat.root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const a = yield* awaited(
              tx.appendEntry(chat.root.id, { kind: "app.note", model: [user("a")] }),
            );
            const b = yield* awaited(
              tx.appendEntry(chat.root.id, { kind: "app.note", model: [user("b")] }),
            );
            yield* awaited(
              tx.appendEntry(chat.root.id, {
                edits: [{ action: "omit", target: b.id }],
                head: a.id,
                kind: "app.head",
              }),
            );
            const c = yield* awaited(
              tx.appendEntry(chat.root.id, { kind: "app.note", model: [user("c")] }),
            );
            yield* awaited(
              tx.appendEntry(chat.root.id, {
                head: a.id,
                kind: "app.head",
                model: [user("H")],
              }),
            );
            return { a: a.id, b: b.id, c: c.id };
          }),
        ),
      context,
    ),
  );
  const view = yield* awaited(chat.root.context(context));
  expect(view.entries.map((record) => record.id).slice(1)).toEqual([ids.a, ids.b, ids.c]);
  return { chat, view };
});

const applyEditsCarried = Effect.gen(function* () {
  const { chat, view } = yield* applyEditsCarriedStep1;
  expect(view.contributions.map((messages) => messages.map(userText))).toEqual([
    ["H"],
    ["a"],
    [],
    ["c"],
  ]);
  expect(view.messages.map(userText)).toEqual(["H", "a", "c"]);
  chat.setup.settings.compaction = { ...MANUAL, keepRecentTokens: 1 };
  chat.faux.summaries.push(summary());
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  const prompt = userText(chat.faux.summaryRequests[0]!.messages[1]);
  expect(prompt).toContain("<conversation>\n[User]: H\n\n[User]: a\n</conversation>");
  yield* awaited(chat.harness.close(context));
});

describe("context contributions", () => {
  it("apply edits carried by an older head marker in the range", () =>
    Effect.runPromise(applyEditsCarried));
});
