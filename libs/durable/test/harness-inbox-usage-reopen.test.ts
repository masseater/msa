import { type AssistantMessage } from "@msa/ai";
import { LiveDoc } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, chatSetup, openChat, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { directories, answer } from "./harness-inbox-support.ts";
import { makeTempFile, removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";

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
  const setup = chatSetup({ tokensPerSecond: 200, tokenSize: { min: 1, max: 1 } });
  setup.faux.setResponses([answer("first"), answer("x".repeat(400)), answer("again")]);
  let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  yield* awaited(
    (yield* awaited(opened.root.submit({ type: "input", content: "a" }, context))).wait(context),
  );
  yield* awaited(opened.root.submit({ type: "input", content: "b" }, context));
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
