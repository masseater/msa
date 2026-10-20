import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { type CodemodeGlobal, CodemodeJournalDoc } from "../src/codemode/codemode.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import codemodeChatSupport from "./codemode-chat-support.ts";
import codemodeSupport from "./codemode-support.ts";
import support from "./support.ts";

const { codemodeChat } = codemodeChatSupport;
const { DONE, directories, nestedCount, restart, resultText, script, sqlitePath } = codemodeSupport;
const { awaited, context, eventually, openChat, removeDir } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const runsScriptCalls = Effect.gen(function* () {
  const chat = codemodeChat();
  chat.holds.block = false;
  chat.setup.faux.setResponses([
    script(
      `const a = await tools.echo({ text: "a" }); const b = await tools.echo({ text: "b" }); return [a, b];`,
    ),
    DONE,
  ]);
  const { harness, root } = yield* openChat(
    yield* awaited(openNodeSqliteStorage(yield* sqlitePath())),
    chat.setup,
  );
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect(yield* resultText(chat.setup, root)).toEqual({
    isError: false,
    text: '["echo a","echo b"]',
  });
  expect(yield* nestedCount(harness)).toBe(2);
  yield* awaited(harness.close(context));
});

const resumesScriptRestart = Effect.gen(function* () {
  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `const a = await tools.echo({ text: "a" });
			const held = await tools.hold({ id: 1 });
			const b = await tools.echo({ text: "b" });
			return [a, held, b, Date.now() > 0];`,
  );
  expect(result).toEqual({ isError: false, text: '["echo a","held 1","echo b",true]' });
  expect(Object.fromEntries(chat.echo)).toEqual({ a: 1, b: 1 });
  expect(chat.vm.starts).toBe(2);
  expect(chat.holds.runs).toBe(2);
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("runs a script that calls tools as nested calls, and journals each result before delivering it", () =>
    Effect.runPromise(runsScriptCalls));

  it("resumes a script after a restart without running its finished calls again", () =>
    Effect.runPromise(resumesScriptRestart));
});

const replaysResultsOrder = Effect.gen(function* () {
  const chat = codemodeChat();
  const code = `const order = [];
			await Promise.all([tools.slow({ id: 1 }).then(() => order.push(1)), tools.slow({ id: 2 }).then(() => order.push(2))]);
			await tools.echo({ text: order.join(",") });
			await tools.hold({});
			return order;`;
  chat.slows.release(2);
  yield* Effect.forkDetach(
    eventually(() => chat.slows.finished.includes(2)).pipe(
      Effect.andThen(Effect.sync(() => chat.slows.release(1))),
    ),
  );
  const { harness, result } = yield* restart(chat, code);
  expect(result).toEqual({ isError: false, text: "[2,1]" });
  expect(Object.fromEntries(chat.echo)).toEqual({ "2,1": 1 });
  yield* awaited(harness.close(context));
});

const journalsGlobalsTheir = Effect.gen(function* () {
  let counter = 0;
  const globals: CodemodeGlobal[] = [{ execute: () => Promise.resolve(++counter), name: "next" }];
  const chat = codemodeChat({ globals: globals });
  const { harness, result } = yield* restart(
    chat,
    `const n = await next(); await tools.hold({}); return [n, await next()];`,
  );
  expect(result).toEqual({ isError: false, text: "[1,2]" });
  expect(counter).toBe(2);
  yield* awaited(harness.close(context));
});

const keepsScriptClock = Effect.gen(function* () {
  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `const before = [Date.now(), Math.random()];
			await tools.hold({});
			await tools.echo({ text: String(before[0]) + "/" + String(before[1]) });
			return "ok";`,
  );
  expect(result.text).toBe("ok");
  expect([...chat.echo.values()]).toEqual([1]);
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("replays results in the order they arrived, not the order the calls were made", () =>
    Effect.runPromise(replaysResultsOrder));

  it("journals globals with their results and hands a replay the recorded ones", () =>
    Effect.runPromise(journalsGlobalsTheir));

  it("keeps the script's clock and randomness across a restart", () =>
    Effect.runPromise(keepsScriptClock));
});

const endsCallResumed = Effect.gen(function* () {
  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `await tools.echo({ text: "a" }); await tools.hold({});`,
    (opened, task) =>
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* awaited(
          opened.commit(
            (tx) =>
              runPromise(
                Effect.gen(function* () {
                  const journal = yield* awaited(tx.doc(CodemodeJournalDoc, task));
                  journal.entries[0]!.issuedAfter = 7;
                }),
              ),
            context,
          ),
        );
      }),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("after result 1 it had made 2 calls, where it had made 7");
  yield* awaited(harness.close(context));
});

const endsCallOnce = Effect.gen(function* () {
  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `await tools.echo({ text: "a" }); await tools.hold({});`,
    (opened, task) =>
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* awaited(
          opened.commit(
            (tx) =>
              runPromise(
                Effect.gen(function* () {
                  const journal = yield* awaited(tx.doc(CodemodeJournalDoc, task));
                  journal.entries[0]!.id = 99;
                }),
              ),
            context,
          ),
        );
      }),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("it waits without making call 99");
  expect(yield* nestedCount(harness)).toBe(2);
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("ends the call when a resumed script made a different number of calls than before", () =>
    Effect.runPromise(endsCallResumed));

  it("ends the call at once when a resumed script waits without making a call it made before", () =>
    Effect.runPromise(endsCallOnce));
});
