import { rm } from "node:fs/promises";

import {
  AssistantEntry,
  defineEntry,
  type EntryId,
  type SubmissionCreate,
  type SubmissionId,
  UserEntry,
} from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { SessionImpl } from "../src/session/session.ts";
import { chatSetup, openChat } from "./chat-support.ts";
import { directories } from "./harness-submissions-support.ts";
import { ControlledStorage, context } from "./session-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("submissions", () => {
  it("settles submissions by their current record in the transaction", async () => {
    const { harness, root } = await openChat(new ControlledStorage(), chatSetup());
    const session = harness as unknown as SessionImpl;
    const entry = await root.commit(
      async (tx) => (await tx.appendEntry(root.id, { kind: "note" })).id,
      context,
    );
    const create = (record: SubmissionCreate) =>
      session.commitWith(async (tx) => (await tx.createSubmission(record)).id, context);
    const queued = await create({ conversationId: root.id, type: "input", status: "queued" });
    const write = await create({ conversationId: root.id, type: "write", status: "queued" });
    const answer = { status: "done", answer: entry } as const;
    await expect(root.commit((tx) => tx.settleSubmission(queued, answer), context)).rejects.toThrow(
      "is not a placed input",
    );
    await expect(root.commit((tx) => tx.settleSubmission(write, answer), context)).rejects.toThrow(
      "is not a placed input",
    );
    await expect(
      root.commit(
        (tx) => tx.settleSubmission(999_999 as SubmissionId, { status: "unanswered", reason: "x" }),
        context,
      ),
    ).rejects.toThrow("does not exist");

    // A submission created earlier in the same commit settles; a second settlement leaves the first.
    const placed = await session.commitWith(async (tx) => {
      const { id } = await tx.createSubmission({
        conversationId: root.id,
        type: "input",
        status: "placed",
        entry,
      });
      tx.settleSubmission(id, answer);
      tx.settleSubmission(id, { status: "unanswered", reason: "late" });
      return id;
    }, context);
    expect(await (await harness.submission(placed, context))!.status(context)).toMatchObject({
      status: "done",
      entry,
      answer: entry,
    });
    await harness.close(context);
  });
});

describe("submissions", () => {
  it("appends and reads typed entries through tokens", async () => {
    const Counter = defineEntry<{ n: number }>("app.counter");
    const Marker = defineEntry("app.marker");
    const { harness, root } = await openChat(new ControlledStorage(), chatSetup());
    const counter = await root.commit(
      (tx) => tx.appendEntry(Counter, root.id, { data: { n: 1 } }),
      context,
    );
    const n: number = counter.data.n;
    expect(n).toBe(1);
    expect(counter).toEqual({
      id: counter.id,
      conversationId: root.id,
      kind: "app.counter",
      data: { n: 1 },
    });
    const marker = await root.commit((tx) => tx.appendEntry(Marker, root.id, {}), context);
    expect(marker.kind).toBe("app.marker");
    expect(await root.commit((tx) => tx.entry(Counter, counter.id), context)).toEqual(counter);
    expect(await root.commit((tx) => tx.entry(Marker, counter.id), context)).toBeUndefined();
    expect(
      await root.commit((tx) => tx.entry(Counter, 999_999 as EntryId), context),
    ).toBeUndefined();
    expect(Counter.is(counter)).toBe(true);
    expect(AssistantEntry.is(counter)).toBe(false);
    expect([UserEntry.kind, AssistantEntry.kind]).toEqual(["msa.user", "msa.assistant"]);
    await harness.close(context);
  });
});
