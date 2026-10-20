import {
  AssistantEntry,
  type EntryId,
  type SubmissionCreate,
  type SubmissionId,
  UserEntry,
  defineEntry,
} from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { SessionImpl } from "../src/session/session.ts";
import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import directories from "./harness-submissions-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";

const { chatSetup, openChat } = chatSupport;
const { awaited } = effectSupport;
const { removeDir } = platformSupport;
const { ControlledStorage, context } = sessionSupport;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const settlesSubmissionsTheirStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openChat(new ControlledStorage(), chatSetup());
  const session = harness as unknown as SessionImpl;
  const entry = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(tx.appendEntry(root.id, { kind: "note" }))).id;
          }),
        ),
      context,
    ),
  );
  const create = (record: SubmissionCreate) =>
    session.commitWith(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(tx.createSubmission(record))).id;
          }),
        ),
      context,
    );
  const queued = yield* awaited(
    create({ conversationId: root.id, status: "queued", type: "input" }),
  );
  const write = yield* awaited(
    create({ conversationId: root.id, status: "queued", type: "write" }),
  );
  const answer = { answer: entry, status: "done" } as const;
  yield* awaited(
    expect(root.commit((tx) => tx.settleSubmission(queued, answer), context)).rejects.toThrow(
      "is not a placed input",
    ),
  );
  yield* awaited(
    expect(root.commit((tx) => tx.settleSubmission(write, answer), context)).rejects.toThrow(
      "is not a placed input",
    ),
  );
  return { answer, entry, harness, root, runPromise, session };
});

const settlesSubmissionsTheir = Effect.gen(function* () {
  const { runPromise, harness, root, session, entry, answer } = yield* settlesSubmissionsTheirStep1;
  yield* awaited(
    expect(
      root.commit(
        (tx) => tx.settleSubmission(999_999 as SubmissionId, { reason: "x", status: "unanswered" }),
        context,
      ),
    ).rejects.toThrow("does not exist"),
  );

  const placed = yield* awaited(
    session.commitWith(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const { id } = yield* awaited(
              tx.createSubmission({
                conversationId: root.id,
                entry,
                status: "placed",
                type: "input",
              }),
            );
            tx.settleSubmission(id, answer);
            tx.settleSubmission(id, { reason: "late", status: "unanswered" });
            return id;
          }),
        ),
      context,
    ),
  );
  expect(
    yield* awaited((yield* awaited(harness.submission(placed, context)))!.status(context)),
  ).toMatchObject({
    answer: entry,
    entry,
    status: "done",
  });
  yield* awaited(harness.close(context));
});

describe("submissions", () => {
  it("settles submissions by their current record in the transaction", () =>
    Effect.runPromise(settlesSubmissionsTheir));
});

const appendsReadsTyped = Effect.gen(function* () {
  const Counter = defineEntry<{ n: number }>("app.counter");
  const Marker = defineEntry("app.marker");
  const { harness, root } = yield* openChat(new ControlledStorage(), chatSetup());
  const counter = yield* awaited(
    root.commit((tx) => tx.appendEntry(Counter, root.id, { data: { n: 1 } }), context),
  );
  const n: number = counter.data.n;
  expect(n).toBe(1);
  expect(counter).toEqual({
    conversationId: root.id,
    data: { n: 1 },
    id: counter.id,
    kind: "app.counter",
  });
  const marker = yield* awaited(root.commit((tx) => tx.appendEntry(Marker, root.id, {}), context));
  expect(marker.kind).toBe("app.marker");
  expect(yield* awaited(root.commit((tx) => tx.entry(Counter, counter.id), context))).toEqual(
    counter,
  );
  expect(
    yield* awaited(root.commit((tx) => tx.entry(Marker, counter.id), context)),
  ).toBeUndefined();
  expect(
    yield* awaited(root.commit((tx) => tx.entry(Counter, 999_999 as EntryId), context)),
  ).toBeUndefined();
  expect(Counter.is(counter)).toBe(true);
  expect(AssistantEntry.is(counter)).toBe(false);
  expect([UserEntry.kind, AssistantEntry.kind]).toEqual(["msa.user", "msa.assistant"]);
  yield* awaited(harness.close(context));
});

describe("submissions", () => {
  it("appends and reads typed entries through tokens", () => Effect.runPromise(appendsReadsTyped));
});
