import { type AssistantMessage } from "@msa/ai";
import durable from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/storage/sqlite/node.ts";
import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessInboxSupport from "./harness-inbox-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";

const { openNodeSqliteStorage } = node;
const { LiveDoc } = durable;

const { allEntries, chatSetup, openChat, waitFor } = chatSupport;
const { awaited } = effectSupport;
const { answer, directories } = harnessInboxSupport;
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

const keepsUsageTotals = Effect.gen(function* () {
  const { directory, path } = yield* makeTempFile("msa-durable-usage-", "session.sqlite");
  directories.add(directory);
  const setup = chatSetup({ tokenSize: { max: 1, min: 1 }, tokensPerSecond: 200 });
  setup.faux.setResponses([answer("first"), answer("x".repeat(400)), answer("again")]);
  let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  yield* awaited(
    (yield* awaited(opened.root.submit({ content: "a", type: "input" }, context))).wait(context),
  );
  yield* awaited(opened.root.submit({ content: "b", type: "input" }, context));
  const live = opened.harness;
  yield* waitFor(
    Effect.gen(function* () {
      return (
        (yield* awaited(live.snapshot(LiveDoc, opened.root.id, context)))?.generation?.message !==
        undefined
      );
    }),
  );
  yield* awaited(opened.harness.close(context));
  opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  opened.harness.resume();
  yield* awaited(opened.harness.waitForIdle(context));
  const assistants = (yield* allEntries(opened.root)).flatMap((entry) =>
    entry.kind === "msa.assistant" ? [entry.model![0] as AssistantMessage] : [],
  );
  expect(assistants.map((message) => message.stopReason)).toEqual(["stop", "aborted", "stop"]);
  const total = (yield* awaited(opened.harness.usage(context))).models["faux/faux-1"]!;
  const sum = (field: "input" | "output" | "totalTokens") =>
    assistants.reduce((value, message) => value + message.usage[field], 0);
  expect([total.input, total.output, total.totalTokens]).toEqual([
    sum("input"),
    sum("output"),
    sum("totalTokens"),
  ]);
  yield* awaited(opened.harness.close(context));
});

describe("usage", () => {
  it("keeps usage totals exact across reopen, counting a partial converted after reopen once", () =>
    Effect.runPromise(keepsUsageTotals));
});
