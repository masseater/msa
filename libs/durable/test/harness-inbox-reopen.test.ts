import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import { directories, transcript, answer, gated } from "./harness-inbox-support.ts";
import { context } from "./session-support.ts";
import { makeTempFile, removeDir } from "./temp-support.ts";

afterEach(async () => {
  for await (const directory of directories) await removeDir(directory);
  directories.clear();
});

describe("inbox", () => {
  it("keeps queued submissions across reopen and settles them afterwards", async () => {
    const { directory, path } = await makeTempFile("msa-durable-inbox-", "session.sqlite");
    directories.add(directory);
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step, answer("first again"), answer("f")]);
    let opened = await openChat(await openNodeSqliteStorage(path), setup);
    await opened.root.submit({ type: "input", content: "a" }, context);
    await first.reached;
    const f = (await opened.root.submit({ type: "input", content: "f" }, context)).id;
    await opened.harness.close(context);

    opened = await openChat(await openNodeSqliteStorage(path), setup);
    const settled = await (await opened.harness.submission(f, context))!.wait(context);
    expect(settled).toMatchObject({ status: "done" });
    expect(transcript(await allEntries(opened.root)).slice(-2)).toEqual([
      "msa.user:f",
      "msa.assistant:f",
    ]);
    await opened.harness.close(context);
  });
});
