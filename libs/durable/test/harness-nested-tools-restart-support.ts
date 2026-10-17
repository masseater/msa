import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AssistantMessage,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type ToolResultMessage,
  Type,
} from "@msa/ai";
import {
  defineTool,
  type Harness,
  type NestedToolExecutionResult,
  type Task,
  type TaskId,
  type ToolRegistration,
  ToolResultEntry,
  ToolTask,
  type ToolTaskInput,
} from "@msa/durable";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, type ChatSetup, openChat } from "./chat-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";

export const Parameters = Type.Object({ text: Type.Optional(Type.String()) });

export function tool(
  name: string,
  execute: ToolRegistration<typeof Parameters>["execute"],
  extra: Partial<ToolRegistration<typeof Parameters>> = {},
): ToolRegistration<typeof Parameters> {
  return defineTool({ name, description: name, parameters: Parameters, execute, ...extra });
}

export function call(name: string, id = "c1"): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, {}, { id })], { stopReason: "toolUse" });
}

export const DONE = fauxAssistantMessage([fauxText("done")]);

export const directories = new Set<string>();

export async function sqlitePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msa-durable-nested-restart-"));
  directories.add(directory);
  return join(directory, "session.sqlite");
}

// Open the SQLite Harness without starting scheduling.
export function open(path: string, setup: ChatSetup) {
  return openNodeSqliteStorage(path).then((storage) => openChat(storage, setup));
}

export async function nestedTasks(harness: Harness) {
  const tasks = (
    await harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context)
  ).items;
  return tasks.filter((task) => (task.input as ToolTaskInput).kind === "nested");
}

export function results(entries: Awaited<ReturnType<typeof allEntries>>): ToolResultMessage[] {
  return entries
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => entry.model![0] as ToolResultMessage);
}

export function codes(result: NestedToolExecutionResult | undefined): string[] {
  return (result?.diagnostics ?? []).flatMap((diagnostic) =>
    diagnostic.code === undefined ? [] : [diagnostic.code],
  );
}

// Register `spawn`, which creates a `Worker` task it owns and waits for it, and `batch`, which makes `spawn` a nested
// call, and let the model call `batch`. Returns where `spawn` records the worker's ID.
export function spawnThroughBatch(
  setup: ChatSetup,
  Worker: Task<null, { phase: "work" }, null, object>,
) {
  const spawned: { worker?: TaskId } = {};
  addTool(
    setup.registry,
    tool("spawn", async (_args, api, callContext) => {
      spawned.worker = await api.createTask(
        Worker,
        null,
        { ownership: { kind: "task", taskId: api.taskId } },
        callContext,
      );
      await api.waitForTask(spawned.worker, callContext);
      return {};
    }),
  );
  addTool(
    setup.registry,
    tool("batch", async (_args, api, callContext) => {
      await api.executeTool("spawn", {}, callContext);
      return {};
    }),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return spawned;
}

// Submit "go", close the Harness once `reached` holds, and reopen it without starting scheduling.
export async function restartDuring(path: string, setup: ChatSetup, reached: Promise<unknown>) {
  const first = await open(path, setup);
  const id = (await first.root.submit({ type: "input", content: "go" }, context)).id;
  await reached;
  await first.harness.close(context);
  return { opened: await open(path, setup), id };
}
