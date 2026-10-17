import { rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  summary,
  directories,
  MANUAL,
  userText,
  open,
  result,
  user,
} from "./harness-compaction-support.ts";
import { context } from "./session-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("context contributions", () => {
  it("apply edits carried by an older head marker in the range", async () => {
    const chat = await open();
    const ids = await chat.root.commit(async (tx) => {
      const a = await tx.appendEntry(chat.root.id, { kind: "app.note", model: [user("a")] });
      const b = await tx.appendEntry(chat.root.id, { kind: "app.note", model: [user("b")] });
      // An older marker that omits b, then a newer one whose range still contains the older marker.
      await tx.appendEntry(chat.root.id, {
        kind: "app.head",
        head: a.id,
        edits: [{ target: b.id, action: "omit" }],
      });
      const c = await tx.appendEntry(chat.root.id, { kind: "app.note", model: [user("c")] });
      await tx.appendEntry(chat.root.id, { kind: "app.head", head: a.id, model: [user("H")] });
      return { a: a.id, b: b.id, c: c.id };
    }, context);
    const view = await chat.root.context(context);
    expect(view.entries.map((record) => record.id).slice(1)).toEqual([ids.a, ids.b, ids.c]);
    expect(view.contributions.map((messages) => messages.map(userText))).toEqual([
      ["H"],
      ["a"],
      [],
      ["c"],
    ]);
    expect(view.messages.map(userText)).toEqual(["H", "a", "c"]);
    // The summarizer sees the same contributions: the omitted entry stays out.
    chat.setup.settings.compaction = { ...MANUAL, keepRecentTokens: 1 };
    chat.faux.summaries.push(summary());
    await result(chat, await chat.root.compact(undefined, context));
    const prompt = userText(chat.faux.summaryRequests[0]!.messages[1]);
    expect(prompt).toContain("<conversation>\n[User]: H\n\n[User]: a\n</conversation>");
    await chat.harness.close(context);
  });
});
