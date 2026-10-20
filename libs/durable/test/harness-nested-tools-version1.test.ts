import type chordTypes from "@msa/chord/index.types";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/storage/sqlite/node.ts";
import harnessNestedToolsSupport from "./harness-nested-tools-support.ts";
import support from "./support.ts";
import type supportTypes from "./support.types.ts";

const { openNodeSqliteStorage } = node;
const { AssistantEntry } = durable;
const { ToolTask } = harnessModule;

const { call, directories, echoTool, results, text } = harnessNestedToolsSupport;
const { addTool, allEntries, awaited, chatSetup, context, makeTempFile, openChat, removeDir } =
  support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const storeVersion1 = Effect.fn("storeVersion1")(function* (
  setup: supportTypes.ChatSetup,
  checkpoint: chordTypes.JsonValue,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { directory, path } = yield* makeTempFile("msa-durable-tool-v1-", "session.sqlite");
  directories.add(directory);
  const { harness, root } = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  const id = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const entry = yield* awaited(
              tx.appendEntry(AssistantEntry, root.id, {
                model: [call("echo", { text: "old" })],
              }),
            );
            return yield* awaited(
              tx.createTask(
                ToolTask,
                { assistant: entry.id, callId: "c1", kind: "model" },
                { ownership: { kind: "conversation" } },
              ),
            );
          }),
        ),
      context,
    ),
  );
  yield* awaited(harness.close(context));
  const storage = yield* awaited(openNodeSqliteStorage(path));
  const record = (yield* awaited(storage.task(id, context)))!;
  const { kind: _kind, ...input } = record.input as Extract<
    durableTypes.ToolTaskInput,
    { kind: "model" }
  >;
  const state = { ...record.state, checkpoint } as typeof record.state;
  yield* awaited(
    storage.commit(
      [{ type: "task", value: { ...record, input, state, version: 1 } as typeof record }],
      context,
    ),
  );
  yield* awaited(storage.close(context));
  return { id, path };
});

const migratesPendingVersion = Effect.gen(function* () {
  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  const { path, id } = yield* storeVersion1(setup, { phase: "call" });
  const { harness, root } = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  expect((yield* awaited(harness.getTask(id, context)))?.version).toBe(1);
  harness.resume();
  const settled = yield* awaited(harness.waitForTask(id, context));
  expect(settled.version).toBe(2);
  expect(settled.input).toMatchObject({ callId: "c1", kind: "model" });
  expect(settled.state.outcome).toMatchObject({
    result: { kind: "model" },
    status: "completed",
  });
  expect(echo.state.runs).toBe(1);
  const [result] = results(yield* allEntries(root));
  expect([result!.toolCallId, text(result)]).toEqual(["c1", "echo old"]);
  yield* awaited(harness.close(context));
});

const migratesVersion1 = Effect.gen(function* () {
  const setup = chatSetup();
  const echo = echoTool();
  addTool(setup.registry, echo.registration);
  const intent = { arguments: { text: "old" }, phase: "execute", replay: "unsafe" };
  const { path, id } = yield* storeVersion1(setup, intent);
  const { harness, root } = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  harness.resume();
  const settled = yield* awaited(harness.waitForTask(id, context));
  expect(settled.version).toBe(2);
  expect(settled.state.outcome).toMatchObject({
    result: { kind: "model" },
    status: "failed",
  });
  expect(echo.state.runs).toBe(0);
  const [result] = results(yield* allEntries(root));
  expect(result).toMatchObject({ isError: true, toolCallId: "c1" });
  expect(text(result)).toContain("Tool echo was interrupted");
  yield* awaited(harness.close(context));
});

describe("tool task version 1 records", () => {
  it("migrates a pending version 1 task and runs it as a model-issued call", () =>
    Effect.runPromise(migratesPendingVersion));

  it("migrates a version 1 task interrupted after intent and settles it interrupted", () =>
    Effect.runPromise(migratesVersion1));
});
