import { type AssistantMessage, fauxAssistantMessage, fauxText, fauxToolCall } from "@msa/ai";
import {
  type Harness,
  type TaskId,
  ToolResultEntry,
  ToolTask,
  type ToolTaskInput,
} from "@msa/durable";
import { expect } from "vite-plus/test";

import { type CodemodeToolDetails } from "../src/codemode/codemode.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, type ChatSetup, openChat } from "./chat-support.ts";
import { codemodeChat } from "./codemode-chat-support.ts";
import { context } from "./session-support.ts";
import { makeTempFile, removeDir, makeTempDir } from "./temp-support.ts";

export const DONE = fauxAssistantMessage([fauxText("done")]);

export function script(code: string): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall("codemode", { code }, { id: "s1" })], {
    stopReason: "toolUse",
  });
}

export const directories = new Set<string>();

export async function removeDirectories(): Promise<void> {
  for await (const directory of directories) await removeDir(directory);
  directories.clear();
}

export async function sqlitePath(): Promise<string> {
  const { directory, path } = await makeTempFile("msa-durable-codemode-", "session.sqlite");
  directories.add(directory);
  return path;
}

// Open the chat on the SQLite storage at `path`.
export async function openStoredChat(
  path: string,
  setup: ChatSetup,
  options?: Parameters<typeof openChat>[2],
) {
  return openChat(await openNodeSqliteStorage(path), setup, options);
}

// A fresh working directory for a Node environment, removed after the test.
export async function envDirectory(): Promise<string> {
  const cwd = await makeTempDir("msa-codemode-env-");
  directories.add(cwd);
  return cwd;
}

// The details of the code mode call's result.
export async function resultDetails(
  root: Awaited<ReturnType<typeof openChat>>["root"],
): Promise<CodemodeToolDetails | undefined> {
  const entry = (await allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  return (entry.model![0] as { details?: CodemodeToolDetails }).details;
}

export async function scriptTask(harness: Harness): Promise<TaskId> {
  const tasks = (
    await harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context)
  ).items;
  return tasks.find((task) => (task.input as ToolTaskInput).kind === "model")!.id;
}

export async function nestedCount(harness: Harness): Promise<number> {
  const tasks = (
    await harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context)
  ).items;
  return tasks.filter((task) => (task.input as ToolTaskInput).kind === "nested").length;
}

// The code mode call's result text.
export async function resultText(
  setup: ChatSetup,
  root: Awaited<ReturnType<typeof openChat>>["root"],
) {
  void setup;
  const entry = (await allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  const message = entry.model![0]!;
  return {
    // Without the "Script completed" header and its wall time, which tests of it check themselves.
    text:
      message.role === "toolResult"
        ? message.content
            .map((item) => (item.type === "text" ? item.text : ""))
            .join("")
            .replace(/^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n/u, "")
        : "",
    isError: message.role === "toolResult" && message.isError,
  };
}

// Run `code` until `holds.reached`, close the Harness (a restart), let `between` change the stored state, then reopen
// with `hold` no longer blocking and wait for the answer.
export async function restart(
  chat: ReturnType<typeof codemodeChat>,
  code: string,
  between: (harness: Harness, task: TaskId) => Promise<void> = async () => {},
  beforeClose: (harness: Harness, task: TaskId) => Promise<void> = async () => {},
) {
  const path = await sqlitePath();
  chat.setup.faux.setResponses([script(code), DONE]);
  let opened = await openStoredChat(path, chat.setup);
  const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
  await chat.holds.reached.promise;
  await beforeClose(opened.harness, await scriptTask(opened.harness));
  await opened.harness.close(context);
  chat.holds.block = false;
  opened = await openStoredChat(path, chat.setup);
  await between(opened.harness, await scriptTask(opened.harness));
  opened.harness.resume();
  expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe("done");
  return { ...opened, result: await resultText(chat.setup, opened.root) };
}

// Run `code` once in a chat with a Node environment; the result's content and details.
export async function runScript(code: string, chat = codemodeChat()) {
  chat.holds.block = false;
  const cwd = await envDirectory();
  chat.setup.faux.setResponses([script(code), DONE]);
  const { harness, root } = await openStoredChat(await sqlitePath(), chat.setup, {
    env: new NodeExecutionEnv({ cwd }),
  });
  await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
  const entry = (await allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  const model = entry.model![0];
  const message = {
    ...(model as { content: { type: string; text?: string }[]; isError: boolean }),
    details: (model as { details?: CodemodeToolDetails }).details,
  };
  await harness.close(context);
  return { text: message.content.map((item) => item.text ?? `<${item.type}>`).join(""), message };
}
