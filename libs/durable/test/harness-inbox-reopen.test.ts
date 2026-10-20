import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessInboxSupport from "./harness-inbox-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";

const { allEntries, chatSetup, openChat } = chatSupport;
const { awaited } = effectSupport;
const { answer, directories, gated, transcript } = harnessInboxSupport;
const { makeTempFile, removeDir } = platformSupport;
const { context } = sessionSupport;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const keepsQueuedSubmissions = Effect.gen(function* () {
  const { directory, path } = yield* makeTempFile("msa-durable-inbox-", "session.sqlite");
  directories.add(directory);
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step, answer("first again"), answer("f")]);
  let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  yield* awaited(opened.root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  const f = (yield* awaited(opened.root.submit({ content: "f", type: "input" }, context))).id;
  yield* awaited(opened.harness.close(context));

  opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  const settled = yield* awaited(
    (yield* awaited(opened.harness.submission(f, context)))!.wait(context),
  );
  expect(settled).toMatchObject({ status: "done" });
  expect(transcript(yield* allEntries(opened.root)).slice(-2)).toEqual([
    "msa.user:f",
    "msa.assistant:f",
  ]);
  yield* awaited(opened.harness.close(context));
});

describe("inbox", () => {
  it("keeps queued submissions across reopen and settles them afterwards", () =>
    Effect.runPromise(keepsQueuedSubmissions));
});
