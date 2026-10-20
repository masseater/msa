import { fauxAssistantMessage } from "@msa/ai";
import harnessModule from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/storage/sqlite/node.ts";
import directories from "./harness-submissions-support.ts";
import support from "./support.ts";

const { openNodeSqliteStorage } = node;
const { GenerationTask } = harnessModule;

const {
  ControlledStorage,
  awaited,
  chatSetup,
  context,
  joinPath,
  makeTempDir,
  openChat,
  removeDir,
  unanswered,
} = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-submissions-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});

const reacquiresSubmissionReopen = Effect.gen(function* () {
  const path = yield* sqlitePath();
  const setup = chatSetup();
  const busy = unanswered();
  setup.faux.setResponses([busy.step, fauxAssistantMessage("after reopen")]);
  let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  const id = (yield* awaited(
    opened.root.submit({ content: "hi", requestId: "print", type: "input" }, context),
  )).id;
  yield* awaited(busy.reached);
  yield* awaited(opened.harness.close(context));

  opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  const submission = (yield* awaited(opened.harness.submission(id, context)))!;
  expect((yield* awaited(submission.status(context))).status).toBe("placed");
  opened.harness.resume();
  const settled = yield* awaited(submission.wait(context));
  if (settled.status !== "done" || settled.type !== "input")
    throw new Error(`Unexpected ${settled.status}`);
  yield* awaited(opened.harness.close(context));

  opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  expect(
    yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)),
  ).toEqual(settled);
  const again = yield* awaited(
    opened.root.submit({ content: "hi", requestId: "print", type: "input" }, context),
  );
  expect(again.id).toBe(id);
  yield* awaited(opened.harness.close(context));
});

describe("submissions", () => {
  it("reacquires a submission after reopen and settles it durably", () =>
    Effect.runPromise(reacquiresSubmissionReopen));
});

const enablesSchedulingCaller = Effect.gen(function* () {
  const setup = chatSetup();
  setup.faux.setResponses([fauxAssistantMessage("answer")]);
  const { harness, root } = yield* openChat(new ControlledStorage(), setup);
  expect(
    (yield* awaited(
      (yield* awaited(root.submit({ content: "hi", type: "input" }, context))).wait(context),
    )).status,
  ).toBe("done");
  yield* awaited(harness.close(context));

  const passive = yield* openChat(new ControlledStorage(), chatSetup());
  const taskId = yield* awaited(
    passive.root.commit(
      (tx) => tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  expect((yield* awaited(passive.harness.getTask(taskId, context)))?.state.status).toBe("pending");
  expect((yield* awaited(passive.harness.waitForTask(taskId, context))).state.status).toBe(
    "terminal",
  );
  yield* awaited(passive.harness.close(context));
});

describe("submissions", () => {
  it("enables scheduling when a caller submits or waits", () =>
    Effect.runPromise(enablesSchedulingCaller));
});
