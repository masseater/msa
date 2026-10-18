import { CodemodeSandbox } from "@msa/codemode";
import { ToolResultEntry, type ToolTaskInput } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  CodemodeJournalDoc,
  CodemodeRunDoc,
  type CodemodeToolDetails,
  createCodemodeTool,
} from "../src/codemode/codemode.ts";
import { allEntries, openChat } from "./chat-support.ts";
import { codemodeChat, tool } from "./codemode-chat-support.ts";
import {
  restart,
  resultText,
  scriptTask,
  DONE,
  script,
  sqlitePath,
  nestedCount,
  removeDirectories,
  openStoredChat,
} from "./codemode-support.ts";
import { awaited } from "./effect-support.ts";
import { addTool } from "./harness-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { deferred, eventually } from "./task-support.ts";

afterEach(removeDirectories);

const recordsCountLive = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = codemodeChat();
  const path = yield* sqlitePath();
  chat.setup.faux.setResponses([
    script(`await tools.echo({ text: "a" }); await tools.hold({});`),
    DONE,
  ]);
  let opened = yield* openStoredChat(path, chat.setup);
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(chat.holds.reached.promise);
  yield* awaited(opened.harness.close(context));
  chat.holds.reached = deferred();
  opened = yield* openStoredChat(path, chat.setup);
  const task = yield* scriptTask(opened.harness);
  yield* awaited(
    opened.harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            delete (yield* awaited(tx.doc(CodemodeJournalDoc, task))).entries[0]!.issuedAfter;
          }),
        ),
      context,
    ),
  );
  opened.harness.resume();
  yield* awaited(chat.holds.reached.promise);
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (
          (yield* awaited(opened.harness.snapshot(CodemodeJournalDoc, task, context)))?.entries[0]
            ?.issuedAfter === 2
        );
      }),
    ),
  );
  yield* awaited(opened.harness.close(context));
  chat.holds.block = false;
  opened = yield* openStoredChat(path, chat.setup);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  yield* awaited(opened.harness.close(context));
});

describe("durable code mode", () => {
  it("records a count the live run never recorded as soon as a replay acknowledges it", () =>
    Effect.runPromise(recordsCountLive));
});

const listsScriptTool = Effect.gen(function* () {
  const chat = codemodeChat();
  addTool(
    chat.setup.registry,
    tool("fails", () =>
      Promise.resolve({
        output: [{ type: "text", text: "permission denied" }],
        isError: true,
      }),
    ),
  );
  chat.setup.faux.setResponses([
    script(
      `await tools.echo({ text: "a" }); try { await tools.fails({}); } catch {} tools.hold({ id: 9 }); return 1;`,
    ),
    DONE,
  ]);
  const { harness, root } = yield* openStoredChat(yield* sqlitePath(), chat.setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  const entry = (yield* allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  const details = (entry.model![0] as { details?: CodemodeToolDetails }).details;
  expect(details?.calls).toMatchObject([
    { id: 1, name: "echo", args: '{"text":"a"}', status: "ok" },
    { id: 2, name: "fails", args: "{}", status: "error", error: "permission denied" },
    { id: 3, name: "hold", args: '{"id":9}', status: "cancelled" },
  ]);
  expect(details?.calls[0]?.durationMs).toBeGreaterThanOrEqual(0);
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("lists the script's tool calls in its result's details", () =>
    Effect.runPromise(listsScriptTool));
});

const storesNoOutcome = Effect.gen(function* () {
  const chat = codemodeChat();
  const path = yield* sqlitePath();
  chat.setup.faux.setResponses([
    script(`await tools.echo({ text: "a" }); await tools.hold({}); return "done";`),
    DONE,
  ]);
  let opened = yield* openStoredChat(path, chat.setup);
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(chat.holds.reached.promise);
  const task = yield* scriptTask(opened.harness);
  yield* awaited(chat.sandbox.close());
  yield* Effect.sleep(100);
  expect(
    (yield* awaited(opened.harness.snapshot(CodemodeRunDoc, task, context)))?.result,
  ).toBeUndefined();
  yield* awaited(opened.harness.close(context));
  chat.holds.block = false;
  addTool(
    chat.setup.registry,
    createCodemodeTool({
      sandbox: new CodemodeSandbox({ memoryLimitBytes: 64 * 1024 * 1024 }),
    }),
  );
  opened = yield* openStoredChat(path, chat.setup);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(yield* resultText(chat.setup, opened.root)).toEqual({
    text: "done",
    isError: false,
  });
  expect(Object.fromEntries(chat.echo)).toEqual({ a: 1 });
  yield* awaited(opened.harness.close(context));
});

describe("durable code mode", () => {
  it("stores no outcome when the host closes the sandbox, and replays the script after a restart", () =>
    Effect.runPromise(storesNoOutcome));
});

const abortsCallStill = Effect.gen(function* () {
  const chat = codemodeChat();
  chat.setup.faux.setResponses([
    script(`tools.hold({}); await tools.echo({ text: "a" }); return 1;`),
    DONE,
  ]);
  const { harness, root } = yield* openStoredChat(yield* sqlitePath(), chat.setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  expect(yield* resultText(chat.setup, root)).toEqual({ text: "1", isError: false });
  const tasks = (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context),
  )).items;
  const hold = tasks.find(
    (task) =>
      (task.input as ToolTaskInput).kind === "nested" &&
      (task.input as { call: { name: string } }).call.name === "hold",
  )!;
  expect(chat.holds.runs).toBe(1);
  expect(hold.state).toMatchObject({ status: "terminal", outcome: { status: "aborted" } });
  yield* awaited(harness.close(context));
});

const admitsNoCall = Effect.gen(function* () {
  const chat = codemodeChat();
  chat.holds.block = false;
  const storage = new ControlledStorage();
  chat.vm.onStart = (run) => {
    const held = storage.holdCommits();
    void run.result.then(() => held.release());
  };
  chat.setup.faux.setResponses([script(`tools.echo({ text: "late" }); return 1;`), DONE]);
  const { harness, root } = yield* openChat(storage, chat.setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  expect(yield* resultText(chat.setup, root)).toEqual({ text: "1", isError: false });
  expect(chat.echo.size).toBe(0);
  expect(yield* nestedCount(harness)).toBe(0);
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("aborts a call still running when the script ends", () => Effect.runPromise(abortsCallStill));

  it("admits no call once the script has ended, even one it made before ending", () =>
    Effect.runPromise(admitsNoCall));
});

const checksRerunCalls = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `const k = load("k");
			tools.echo({ text: k ?? "a" });
			if (k) tools.echo({ text: "new" });
			await tools.hold({});`,
    (opened, task) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            opened.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const run = yield* awaited(tx.doc(CodemodeRunDoc, task));
                    run.start!.store = { k: "x" };
                    (yield* awaited(tx.doc(CodemodeJournalDoc, task))).entries.length = 0;
                  }),
                ),
              context,
            ),
          );
        }),
      ),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("its first run made 3 calls, where it had made 2");
  expect(yield* nestedCount(harness)).toBe(2);
  expect(Object.fromEntries(chat.echo)).toEqual({ a: 1 });
  yield* awaited(harness.close(context));
});

const endsCallRerun = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = codemodeChat({ globals: [{ name: "pick", execute: () => Promise.resolve(1) }] });
  const { harness, result } = yield* restart(
    chat,
    `if (load("k")) { await pick(); await tools.echo({ text: "new" }); } else { await tools.hold({}); }`,
    (opened, task) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            opened.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const run = yield* awaited(tx.doc(CodemodeRunDoc, task));
                    run.start!.store = { k: true };
                  }),
                ),
              context,
            ),
          );
        }),
      ),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("call 1 is pick(), but was tools.hold({})");
  expect(chat.echo.size).toBe(0);
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("checks a rerun's calls against an earlier attempt's before admitting any later call", () =>
    Effect.runPromise(checksRerunCalls));

  it("ends the call when a rerun makes a global call where an earlier attempt made a tool call", () =>
    Effect.runPromise(endsCallRerun));
});

const endsCallRerunFirst = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = codemodeChat({ globals: [{ name: "pick", execute: () => Promise.resolve(1) }] });
  const { harness, result } = yield* restart(
    chat,
    `const k = load("k");
			const first = tools.hold({ id: 1 });
			if (!k) tools.hold({ id: 2 });
			await first;
			await pick();
			await tools.echo({ text: "new" });`,
    (opened, task) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            opened.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const run = yield* awaited(tx.doc(CodemodeRunDoc, task));
                    run.start!.store = { k: true };
                  }),
                ),
              context,
            ),
          );
        }),
      ),
    (opened, task) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* eventually(() =>
            runPromise(
              Effect.gen(function* () {
                return (
                  (yield* awaited(opened.snapshot(CodemodeJournalDoc, task, context)))
                    ?.firstIssued === 2
                );
              }),
            ),
          );
        }),
      ),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("its first run made 1 calls, where it had made 2");
  expect(chat.echo.size).toBe(0);
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("ends the call when a rerun's first run makes fewer calls than an earlier attempt admitted", () =>
    Effect.runPromise(endsCallRerunFirst));
});

const endsCallRerunWithout = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `if (load("k")) { store("x", 1); return "early"; } await tools.hold({});`,
    (opened, task) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            opened.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const run = yield* awaited(tx.doc(CodemodeRunDoc, task));
                    run.start!.store = { k: true };
                  }),
                ),
              context,
            ),
          );
        }),
      ),
    (opened, task) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* eventually(() =>
            runPromise(
              Effect.gen(function* () {
                return (
                  (yield* awaited(opened.snapshot(CodemodeJournalDoc, task, context)))
                    ?.firstIssued === 1
                );
              }),
            ),
          );
        }),
      ),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("it ended after result 0, where it went on before");
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("ends the call when a rerun without journal entries ends in its first run, where it went on before", () =>
    Effect.runPromise(endsCallRerunWithout));
});
