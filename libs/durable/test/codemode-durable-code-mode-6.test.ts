import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import codemode from "../src/codemode/codemode.ts";
import codemodeChatSupport from "./codemode-chat-support.ts";
import codemodeSupport from "./codemode-support.ts";
import support from "./support.ts";

const { CodemodeJournalDoc, CodemodeRunDoc } = codemode;

const { codemodeChat } = codemodeChatSupport;
const { nestedCount, removeDirectories, restart } = codemodeSupport;
const { awaited, context, eventually } = support;

afterEach(removeDirectories);

const checksRerunCalls = Effect.gen(function* () {
  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `const k = load("k");
			tools.echo({ text: k ?? "a" });
			if (k) tools.echo({ text: "new" });
			await tools.hold({});`,
    (opened, task) =>
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
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("its first run made 3 calls, where it had made 2");
  expect(yield* nestedCount(harness)).toBe(2);
  expect(Object.fromEntries(chat.echo)).toEqual({ a: 1 });
  yield* awaited(harness.close(context));
});

const endsCallRerun = Effect.gen(function* () {
  const chat = codemodeChat({ globals: [{ execute: () => Promise.resolve(1), name: "pick" }] });
  const { harness, result } = yield* restart(
    chat,
    `if (load("k")) { await pick(); await tools.echo({ text: "new" }); } else { await tools.hold({}); }`,
    (opened, task) =>
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
  const chat = codemodeChat({ globals: [{ execute: () => Promise.resolve(1), name: "pick" }] });
  const { harness, result } = yield* restart(
    chat,
    `const k = load("k");
			const first = tools.hold({ id: 1 });
			if (!k) tools.hold({ id: 2 });
			await first;
			await pick();
			await tools.echo({ text: "new" });`,
    (opened, task) =>
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
    (opened, task) =>
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
  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `if (load("k")) { store("x", 1); return "early"; } await tools.hold({});`,
    (opened, task) =>
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
    (opened, task) =>
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
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("it ended after result 0, where it went on before");
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("ends the call when a rerun without journal entries ends in its first run, where it went on before", () =>
    Effect.runPromise(endsCallRerunWithout));
});
