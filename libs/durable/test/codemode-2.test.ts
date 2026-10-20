import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { CodemodeJournalDoc, CodemodeRunDoc } from "../src/codemode/codemode.ts";
import codemodeChatSupport from "./codemode-chat-support.ts";
import codemodeSupport from "./codemode-support.ts";
import support from "./support.ts";

const { codemodeChat } = codemodeChatSupport;
const { directories, nestedCount, restart } = codemodeSupport;
const { awaited, context, eventually, removeDir } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const endsCallResumedScript = Effect.gen(function* () {
  const chat = codemodeChat({ globals: [{ execute: () => Promise.resolve(1), name: "next" }] });
  const { harness, result } = yield* restart(
    chat,
    `await next(); await tools.hold({});`,
    (opened, task) =>
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* awaited(
          opened.commit(
            (tx) =>
              runPromise(
                Effect.gen(function* () {
                  const journal = yield* awaited(tx.doc(CodemodeJournalDoc, task));
                  journal.entries[0]!.global!.args = "other";
                }),
              ),
            context,
          ),
        );
      }),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("call 1 is next");
  yield* awaited(harness.close(context));
});

const admitsNoCall = Effect.gen(function* () {
  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `await tools.echo({ text: "a" });
			const extra = load("k") ?? 0;
			for (let i = 0; i < extra; i++) tools.echo({ text: "extra" + i });
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
                  run.start!.store = { k: 3 };
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
                (yield* awaited(opened.snapshot(CodemodeJournalDoc, task, context)))?.entries[0]
                  ?.issuedAfter === 2
              );
            }),
          ),
        );
      }),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("after result 1 it had made 5 calls, where it had made 2");
  expect(Object.fromEntries(chat.echo)).toEqual({ a: 1 });
  expect(yield* nestedCount(harness)).toBe(2);
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("ends the call when a resumed script calls a global with other arguments", () =>
    Effect.runPromise(endsCallResumedScript));

  it("admits no call of a diverging replay, even one the script never made before", () =>
    Effect.runPromise(admitsNoCall));
});

const endsCallResumedScriptEnds = Effect.gen(function* () {
  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `await tools.echo({ text: "a" }); if (load("k")) return "early"; await tools.hold({});`,
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
                (yield* awaited(opened.snapshot(CodemodeJournalDoc, task, context)))?.entries[0]
                  ?.issuedAfter === 2
              );
            }),
          ),
        );
      }),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("it ended after result 1, where it went on before");
  yield* awaited(harness.close(context));
});

const endsCallResumedScriptEndsCalls = Effect.gen(function* () {
  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `await tools.echo({ text: "a" }); if (load("k")) return "early"; await tools.echo({ text: "b" }); await tools.hold({});`,
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
                  const journal = yield* awaited(tx.doc(CodemodeJournalDoc, task));
                  delete journal.entries[0]!.issuedAfter;
                }),
              ),
            context,
          ),
        );
      }),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("it ended after result 1, where it went on before");
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("ends the call when a resumed script ends where it went on before", () =>
    Effect.runPromise(endsCallResumedScriptEnds));

  it("ends the call when a resumed script ends before calls the live run made, even without a recorded count", () =>
    Effect.runPromise(endsCallResumedScriptEndsCalls));
});

const endsCallResumedScriptMakes = Effect.gen(function* () {
  const chat = codemodeChat();
  const { harness, result } = yield* restart(
    chat,
    `await tools.echo({ text: load("k") ?? "a" }); await tools.hold({});`,
    (opened, task) =>
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* awaited(
          opened.commit(
            (tx) =>
              runPromise(
                Effect.gen(function* () {
                  const run = yield* awaited(tx.doc(CodemodeRunDoc, task));
                  run.start!.store = { k: "other" };
                  const journal = yield* awaited(tx.doc(CodemodeJournalDoc, task));
                  journal.entries.length = 0;
                }),
              ),
            context,
          ),
        );
      }),
  );
  expect(result.isError).toBe(true);
  expect(result.text).toContain("different path");
  expect(result.text).toContain("call 1 is tools.echo");
  expect(Object.fromEntries(chat.echo)).toEqual({ a: 1 });
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("ends the call when a resumed script makes a call an earlier attempt admitted with other arguments", () =>
    Effect.runPromise(endsCallResumedScriptMakes));
});
