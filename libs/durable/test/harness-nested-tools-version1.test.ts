import type { JsonValue } from "@msa/chord";
import { AssistantEntry, type ToolTaskInput } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { directories, results, text, call, echoTool } from "./harness-nested-tools-support.ts";
import {
  allEntries,
  type ChatSetup,
  chatSetup,
  openChat,
  awaited,
  addTool,
  makeTempFile,
  removeDir,
  context,
} from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const storeVersion1 = Effect.fn("storeVersion1")(function* (
  setup: ChatSetup,
  checkpoint: JsonValue,
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
                { kind: "model", assistant: entry.id, callId: "c1" },
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
  const { kind: _kind, ...input } = record.input as Extract<ToolTaskInput, { kind: "model" }>;
  const state = { ...record.state, checkpoint } as typeof record.state;
  yield* awaited(
    storage.commit(
      [{ type: "task", value: { ...record, version: 1, input, state } as typeof record }],
      context,
    ),
  );
  yield* awaited(storage.close(context));
  return { path, id };
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
  expect(settled.input).toMatchObject({ kind: "model", callId: "c1" });
  expect(settled.state.outcome).toMatchObject({
    status: "completed",
    result: { kind: "model" },
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
  const intent = { phase: "execute", arguments: { text: "old" }, replay: "unsafe" };
  const { path, id } = yield* storeVersion1(setup, intent);
  const { harness, root } = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  harness.resume();
  const settled = yield* awaited(harness.waitForTask(id, context));
  expect(settled.version).toBe(2);
  expect(settled.state.outcome).toMatchObject({
    status: "failed",
    result: { kind: "model" },
  });
  expect(echo.state.runs).toBe(0);
  const [result] = results(yield* allEntries(root));
  expect(result).toMatchObject({ toolCallId: "c1", isError: true });
  expect(text(result)).toContain("Tool echo was interrupted");
  yield* awaited(harness.close(context));
});

describe("tool task version 1 records", () => {
  it("migrates a pending version 1 task and runs it as a model-issued call", () =>
    Effect.runPromise(migratesPendingVersion));

  it("migrates a version 1 task interrupted after intent and settles it interrupted", () =>
    Effect.runPromise(migratesVersion1));
});
