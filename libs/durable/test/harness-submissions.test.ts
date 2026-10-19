import { fauxAssistantMessage } from "@msa/ai";
import {
  ConversationBusy,
  LiveDoc,
  type SubmissionId,
  type SubmissionRecord,
  UserEntry,
} from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { directories } from "./harness-submissions-support.ts";
import {
  allEntries,
  chatSetup,
  openChat,
  unanswered,
  abortController,
  awaited,
  removeDir,
  ControlledStorage,
  context,
  deferred,
} from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const appendsIdleWrite = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new ControlledStorage(), chatSetup());
  const submission = yield* awaited(
    root.submit({ type: "write", entry: { kind: "note", data: { text: "x" } } }, context),
  );
  const settled = yield* awaited(submission.wait(context));
  expect(settled).toEqual({
    id: submission.id,
    conversationId: root.id,
    type: "write",
    status: "done",
    entry: expect.any(Number),
  });
  const entries = yield* allEntries(root);
  expect(entries).toEqual([
    { id: settled.entry, conversationId: root.id, kind: "note", data: { text: "x" } },
  ]);
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  const tasks = yield* awaited(
    harness.commit((tx) => tx.scanTasks({ conversationId: root.id }, 10), context),
  );
  expect(tasks.items).toEqual([]);
  yield* awaited(harness.close(context));
});

describe("submissions", () => {
  it("appends an idle write and settles it done without a turn", () =>
    Effect.runPromise(appendsIdleWrite));
});

const placesIdleInput = Effect.gen(function* () {
  const storage = new ControlledStorage();
  const setup = chatSetup();
  setup.now = () => 42;
  const busy = unanswered();
  setup.faux.setResponses([busy.step]);
  const { harness, root } = yield* openChat(storage, setup);
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  yield* awaited(busy.reached);
  const record = yield* awaited(submission.status(context));
  if (record.status !== "placed") throw new Error(`Unexpected ${record.status}`);
  const entry = yield* awaited(root.commit((tx) => tx.entry(UserEntry, record.entry), context));
  expect(entry?.model).toEqual([{ role: "user", content: "hi", timestamp: 42 }]);
  const live = yield* awaited(harness.snapshot(LiveDoc, root.id, context));
  expect(live?.run?.inputs).toEqual([submission.id]);
  expect((yield* awaited(harness.getTask(live!.run!.taskId, context)))?.kind).toBe(
    "msa.generation",
  );

  const commits = storage.commits.length;
  const rejected = root.submit({ type: "input", content: "again", whenBusy: "reject" }, context);
  yield* awaited(expect(rejected).rejects.toBeInstanceOf(ConversationBusy));
  yield* awaited(expect(rejected).rejects.toMatchObject({ conversationId: root.id }));
  expect(storage.commits.length).toBe(commits);
  yield* awaited(harness.close(context));
});

describe("submissions", () => {
  it("places idle input, and rejects busy input with whenBusy reject without writing", () =>
    Effect.runPromise(placesIdleInput));
});

const deduplicatesRequestIDs = Effect.gen(function* () {
  const storage = new ControlledStorage();
  const setup = chatSetup();
  const busy = unanswered();
  setup.faux.setResponses([busy.step]);
  const { harness, root } = yield* openChat(storage, setup);
  const first = yield* awaited(
    root.submit({ type: "input", content: "hi", requestId: "r1" }, context),
  );
  yield* awaited(busy.reached);
  const commits = storage.commits.length;
  const again = yield* awaited(
    root.submit({ type: "input", content: "different", requestId: "r1" }, context),
  );
  expect(again.id).toBe(first.id);
  expect(storage.commits.length).toBe(commits);
  yield* awaited(
    expect(
      root.submit({ type: "write", entry: { kind: "note" }, requestId: "r1" }, context),
    ).rejects.toThrow("Request r1 already identifies a submission of type input"),
  );
  expect(yield* awaited(first.status(context))).toMatchObject({
    requestId: "r1",
    status: "placed",
  });

  const other = yield* awaited(
    harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  const write = yield* awaited(
    other.submit({ type: "write", entry: { kind: "note" }, requestId: "r1" }, context),
  );
  expect(write.id).not.toBe(first.id);
  expect(
    (yield* awaited(
      other.submit({ type: "write", entry: { kind: "note" }, requestId: "r1" }, context),
    )).id,
  ).toBe(write.id);
  yield* awaited(harness.close(context));
});

describe("submissions", () => {
  it("deduplicates request IDs per conversation before any write", () =>
    Effect.runPromise(deduplicatesRequestIDs));
});

const reportsAbortResults = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const release = deferred();
  setup.faux.setResponses([
    () =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(release.promise);
          return fauxAssistantMessage("answer");
        }),
      ),
  ]);
  const { harness, root } = yield* openChat(new ControlledStorage(), setup);
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  expect(yield* awaited(submission.abort(context))).toBe("already_placed");
  expect(yield* awaited(harness.abortSubmission(submission.id, context, root.id))).toBe(
    "already_placed",
  );
  const other = yield* awaited(
    harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  expect(yield* awaited(harness.abortSubmission(submission.id, context, other.id))).toBe(
    "not_found",
  );
  expect(yield* awaited(harness.abortSubmission(999_999 as SubmissionId, context))).toBe(
    "not_found",
  );
  expect(yield* awaited(harness.submission(999_999 as SubmissionId, context))).toBeUndefined();

  release.resolve();
  yield* awaited(submission.wait(context));
  expect(yield* awaited(submission.abort(context))).toBe("settled");
  expect(yield* awaited(harness.abortSubmission(submission.id, context))).toBe("settled");
  yield* awaited(harness.close(context));
});

const cancelsOnlyWait = Effect.gen(function* () {
  const setup = chatSetup();
  setup.faux.setResponses([unanswered().step]);
  const { harness, root } = yield* openChat(new ControlledStorage(), setup);
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  const controller = abortController();
  const cancelled = submission.wait({ ...context, abortSignal: controller.signal });
  const pending = submission.wait(context);
  controller.abort(new Error("stop waiting"));
  yield* awaited(expect(cancelled).rejects.toThrow("stop waiting"));
  expect((yield* awaited(submission.status(context))).status).toBe("placed");
  yield* awaited(harness.close(context));
  yield* awaited(expect(pending).rejects.toThrow("Harness is closed"));
});

describe("submissions", () => {
  it("reports abort results and looks submissions up by conversation", () =>
    Effect.runPromise(reportsAbortResults));

  it("cancels only a wait and rejects pending waits on close", () =>
    Effect.runPromise(cancelsOnlyWait));
});

const rejectsWaitSubmission = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const entered = deferred();
  const release = deferred();
  let hold = false;
  class HeldReads extends ControlledStorage {
    override submission(
      id: SubmissionId,
      callContext: typeof context,
    ): Promise<SubmissionRecord | undefined> {
      const superSubmission = super.submission.bind(this);
      return runPromise(
        Effect.gen(function* () {
          if (hold) {
            entered.resolve();
            yield* awaited(release.promise);
          }
          return yield* awaited(superSubmission(id, callContext));
        }),
      );
    }
  }
  const setup = chatSetup();
  setup.faux.setResponses([unanswered().step]);
  const { harness, root } = yield* openChat(new HeldReads(), setup);
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  hold = true;
  const waiting = submission.wait(context);
  yield* awaited(entered.promise);
  const closing = harness.close(context);
  release.resolve();
  yield* awaited(expect(waiting).rejects.toThrow("Harness is closed"));
  yield* awaited(closing);
});

describe("submissions", () => {
  it("rejects a wait whose submission read spans the start of close", () =>
    Effect.runPromise(rejectsWaitSubmission));
});
