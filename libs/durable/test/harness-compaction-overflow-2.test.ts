import { type Message } from "@msa/ai";
import { CompactionTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const { directories, firstUserText, history, kinds, open, result, summary, text, userText } =
  harnessCompactionSupport;
const { addHooks, allEntries, awaited, context, removeDir } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const summarizesReplacedEntry = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const [u1] = yield* allEntries(chat.root);
  yield* awaited(
    chat.root.submit(
      {
        entry: {
          edits: [
            {
              action: "replace",
              messages: [{ content: "REDACTED", role: "user", timestamp: 0 }],
              target: u1!.id,
            },
          ],
          kind: "app.redact",
        },
        type: "write",
      },
      context,
    ),
  );
  let messages: readonly Message[] = [];
  addHooks(chat.setup.registry, CompactionTask, {
    beforeCompact: (compaction) => {
      messages = compaction.messages;
      return undefined;
    },
  });
  chat.faux.summaries.push(summary());
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  expect(firstUserText(messages)).toBe("REDACTED");
  expect(userText(chat.faux.summaryRequests[0]!.messages[1])).toContain("[User]: REDACTED");
  yield* awaited(chat.harness.close(context));
});

describe("compaction estimates and interactions", () => {
  it("summarizes a replaced entry's replacement and shows it to the hook", () =>
    Effect.runPromise(summarizesReplacedEntry));
});

const compactsForkCut = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const entries = yield* allEntries(chat.root);
  const fork = yield* awaited(
    chat.root.fork(entries.at(-1)!.id, { ownership: { kind: "ownerless" } }, context),
  );
  chat.faux.summaries.push(summary());
  const outcome = yield* awaited(result(chat, yield* awaited(fork.compact(undefined, context))));
  const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
  expect(
    (yield* awaited(
      (yield* awaited(chat.harness.submission(submissionId!, context)))!.wait(context),
    )).status,
  ).toBe("done");
  const u3 = entries.find((record) => userText(record.model?.[0]).startsWith("u3"))!;
  const view = yield* awaited(fork.context(context));
  expect(view.head).toMatchObject({
    conversationId: fork.id,
    head: u3.id,
    kind: "msa.compaction",
  });
  expect(view.messages.slice(1).map(userText)).toEqual([text("u3", 100), text("a3", 100)]);
  expect((yield* kinds(chat.root)).includes("msa.compaction")).toBe(false);
  const state = yield* awaited(fork.viewState(context));
  expect(state.value.entries).toEqual(view.entries);
  state.dispose();
  yield* awaited(chat.harness.close(context));
});

describe("compaction estimates and interactions", () => {
  it("compacts a fork whose cut falls on a parent entry", () => Effect.runPromise(compactsForkCut));
});
