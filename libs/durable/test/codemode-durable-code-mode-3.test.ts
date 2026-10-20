import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import codemode from "../src/codemode/codemode.ts";
import codemodeChatSupport from "./codemode-chat-support.ts";
import codemodeSupport from "./codemode-support.ts";
import support from "./support.ts";

const { ToolTask } = harnessModule;
const { CodemodeRunDoc } = codemode;
const { ToolResultEntry } = durable;

const { codemodeChat } = codemodeChatSupport;
const { DONE, openStoredChat, removeDirectories, resultText, script, scriptTask, sqlitePath } =
  codemodeSupport;
const { aborted, addHooks, allEntries, awaited, context, deferred } = support;

afterEach(removeDirectories);

const returnsDecidedOutcome = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = codemodeChat();
  const path = yield* sqlitePath();
  chat.holds.block = false;
  chat.setup.faux.setResponses([script(`return "first"`), DONE]);
  const stopped = { block: true, reached: deferred() };
  addHooks(chat.setup.registry, ToolTask, {
    afterTool: (call, _result, _api, hookContext) =>
      runPromise(
        Effect.gen(function* () {
          if (call.name !== "codemode" || !stopped.block) return undefined;
          stopped.reached.resolve();
          return yield* awaited(aborted(hookContext.abortSignal!));
        }),
      ),
  });
  let opened = yield* openStoredChat(path, chat.setup);
  const id = (yield* awaited(opened.root.submit({ content: "go", type: "input" }, context))).id;
  yield* awaited(stopped.reached.promise);
  const task = yield* scriptTask(opened.harness);
  expect(
    (yield* awaited(opened.harness.snapshot(CodemodeRunDoc, task, context)))?.result,
  ).toBeDefined();
  yield* awaited(opened.harness.close(context));
  stopped.block = false;
  opened = yield* openStoredChat(path, chat.setup);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(yield* resultText(chat.setup, opened.root)).toEqual({
    isError: false,
    text: "first",
  });
  expect(chat.vm.starts).toBe(1);
  yield* awaited(opened.harness.close(context));
});

describe("durable code mode", () => {
  it("returns a decided outcome after a restart without running the script again", () =>
    Effect.runPromise(returnsDecidedOutcome));
});

const keepsStoreValues = Effect.gen(function* () {
  const chat = codemodeChat();
  chat.holds.block = false;
  chat.setup.faux.setResponses([
    script(`store("k", 1); return load("k")`),
    DONE,
    script(`return [load("k") ?? null]`),
    DONE,
  ]);
  const { harness, root } = yield* openStoredChat(yield* sqlitePath(), chat.setup);
  yield* awaited(
    (yield* awaited(root.submit({ content: "first", type: "input" }, context))).wait(context),
  );
  const firstUser = (yield* allEntries(root)).find((entry) => entry.kind === "msa.user")!;
  yield* awaited(
    (yield* awaited(root.submit({ content: "second", type: "input" }, context))).wait(context),
  );
  const results = (yield* allEntries(root)).filter((entry) => ToolResultEntry.is(entry));
  const texts = results.map(
    (entry) => (entry.model![0] as { content: { text: string }[] }).content[1]!.text,
  );
  expect(texts).toEqual(["1", "[1]"]);
  chat.setup.faux.setResponses([script(`return [load("k") ?? null]`), DONE]);
  const fork = yield* awaited(
    root.fork(firstUser.id, { ownership: { kind: "ownerless" } }, context),
  );
  yield* awaited(
    (yield* awaited(fork.submit({ content: "fork", type: "input" }, context))).wait(context),
  );
  const forkResult = (yield* allEntries(fork)).filter((entry) => ToolResultEntry.is(entry)).at(-1)!;
  expect((forkResult.model![0] as { content: { text: string }[] }).content[1]!.text).toBe("[null]");
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("keeps store() values per conversation, as of a fork's entry", () =>
    Effect.runPromise(keepsStoreValues));
});

const journalsResultsFinish = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const release = deferred();
  let waiting = 0;
  const chat = codemodeChat({
    globals: [
      {
        execute: () =>
          runPromise(
            Effect.gen(function* () {
              if (++waiting === 50) release.resolve();
              yield* awaited(release.promise);
              return null;
            }),
          ),
        name: "wait",
      },
    ],
  });
  chat.holds.block = false;
  chat.setup.faux.setResponses([
    script(`return (await Promise.all(Array.from({ length: 50 }, () => wait()))).length`),
    DONE,
  ]);
  const { harness, root } = yield* openStoredChat(yield* sqlitePath(), chat.setup);
  let journalCommits = 0;
  harness.subscribeCommits((publication) => {
    for (const change of publication.changes) {
      if (change.type === "document" && change.record.kind === "msa.codemode.journal")
        journalCommits++;
    }
  });
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect(yield* resultText(chat.setup, root)).toEqual({ isError: false, text: "50" });
  expect(journalCommits).toBeLessThan(10);
  yield* awaited(harness.close(context));
});

describe("durable code mode", () => {
  it("journals results that finish together in one commit", () =>
    Effect.runPromise(journalsResultsFinish));
});
