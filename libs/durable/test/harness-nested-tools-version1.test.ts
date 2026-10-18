import type { JsonValue } from "@msa/chord";
import { AssistantEntry, type TaskId, type ToolTaskInput } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, type ChatSetup, chatSetup, openChat } from "./chat-support.ts";
import { directories, results, text, call, echoTool } from "./harness-nested-tools-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { makeTempFile, removeDir } from "./temp-support.ts";

afterEach(async () => {
  for await (const directory of directories) await removeDir(directory);
  directories.clear();
});

// Store a live tool task for call `c1` of an assistant entry, close, and rewrite its record as version 1 stored it:
// `{ assistant, callId }` input at version 1, with `checkpoint`. Returns the storage path and the task ID.
async function storeVersion1(
  setup: ChatSetup,
  checkpoint: JsonValue,
): Promise<{ path: string; id: TaskId }> {
  const { directory, path } = await makeTempFile("msa-durable-tool-v1-", "session.sqlite");
  directories.add(directory);
  // No submission, so the Harness never starts scheduling and the task stays pending.
  const { harness, root } = await openChat(await openNodeSqliteStorage(path), setup);
  const id = await root.commit(async (tx) => {
    const entry = await tx.appendEntry(AssistantEntry, root.id, {
      model: [call("echo", { text: "old" })],
    });
    return tx.createTask(
      ToolTask,
      { kind: "model", assistant: entry.id, callId: "c1" },
      { ownership: { kind: "conversation" } },
    );
  }, context);
  await harness.close(context);
  const storage = await openNodeSqliteStorage(path);
  const record = (await storage.task(id, context))!;
  const { kind: _kind, ...input } = record.input as Extract<ToolTaskInput, { kind: "model" }>;
  const state = { ...record.state, checkpoint } as typeof record.state;
  await storage.commit(
    [{ type: "task", value: { ...record, version: 1, input, state } as typeof record }],
    context,
  );
  await storage.close(context);
  return { path, id };
}

describe("tool task version 1 records", () => {
  it("migrates a pending version 1 task and runs it as a model-issued call", async () => {
    const setup = chatSetup();
    const echo = echoTool();
    addTool(setup.registry, echo.registration);
    const { path, id } = await storeVersion1(setup, { phase: "call" });
    const { harness, root } = await openChat(await openNodeSqliteStorage(path), setup);
    expect((await harness.getTask(id, context))?.version).toBe(1);
    harness.resume();
    const settled = await harness.waitForTask(id, context);
    expect(settled.version).toBe(2);
    expect(settled.input).toMatchObject({ kind: "model", callId: "c1" });
    expect(settled.state.outcome).toMatchObject({ status: "completed", result: { kind: "model" } });
    expect(echo.state.runs).toBe(1);
    const [result] = results(await allEntries(root));
    expect([result!.toolCallId, text(result)]).toEqual(["c1", "echo old"]);
    await harness.close(context);
  });

  it("migrates a version 1 task interrupted after intent and settles it interrupted", async () => {
    const setup = chatSetup();
    const echo = echoTool();
    addTool(setup.registry, echo.registration);
    const intent = { phase: "execute", arguments: { text: "old" }, replay: "unsafe" };
    const { path, id } = await storeVersion1(setup, intent);
    const { harness, root } = await openChat(await openNodeSqliteStorage(path), setup);
    harness.resume();
    const settled = await harness.waitForTask(id, context);
    expect(settled.version).toBe(2);
    expect(settled.state.outcome).toMatchObject({ status: "failed", result: { kind: "model" } });
    expect(echo.state.runs).toBe(0);
    const [result] = results(await allEntries(root));
    expect(result).toMatchObject({ toolCallId: "c1", isError: true });
    expect(text(result)).toContain("Tool echo was interrupted");
    await harness.close(context);
  });
});
