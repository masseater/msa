import { type AssistantMessage } from "@msa/ai";
import { LiveDoc } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, chatSetup, openChat, waitFor } from "./chat-support.ts";
import { directories, answer } from "./harness-inbox-support.ts";
import { context } from "./session-support.ts";
import { makeTempFile, removeDir } from "./temp-support.ts";

afterEach(async () => {
  for await (const directory of directories) await removeDir(directory);
  directories.clear();
});

describe("usage", () => {
  it("keeps usage totals exact across reopen, counting a partial converted after reopen once", async () => {
    const { directory, path } = await makeTempFile("msa-durable-usage-", "session.sqlite");
    directories.add(directory);
    const setup = chatSetup({ tokensPerSecond: 200, tokenSize: { min: 1, max: 1 } });
    setup.faux.setResponses([answer("first"), answer("x".repeat(400)), answer("again")]);
    let opened = await openChat(await openNodeSqliteStorage(path), setup);
    await (await opened.root.submit({ type: "input", content: "a" }, context)).wait(context);
    await opened.root.submit({ type: "input", content: "b" }, context);
    const live = opened.harness;
    await waitFor(
      async () =>
        (await live.snapshot(LiveDoc, opened.root.id, context))?.generation?.message !== undefined,
    );
    // Closing mid-stream keeps the committed partial; the reopened request converts it into an aborted entry.
    await opened.harness.close(context);
    opened = await openChat(await openNodeSqliteStorage(path), setup);
    opened.harness.resume();
    await opened.harness.waitForIdle(context);
    const assistants = (await allEntries(opened.root)).flatMap((entry) =>
      entry.kind === "msa.assistant" ? [entry.model![0] as AssistantMessage] : [],
    );
    expect(assistants.map((message) => message.stopReason)).toEqual(["stop", "aborted", "stop"]);
    const total = (await opened.harness.usage(context)).models["faux/faux-1"]!;
    const sum = (field: "input" | "output" | "totalTokens") =>
      assistants.reduce((value, message) => value + message.usage[field], 0);
    expect([total.input, total.output, total.totalTokens]).toEqual([
      sum("input"),
      sum("output"),
      sum("totalTokens"),
    ]);
    await opened.harness.close(context);
  });
});
