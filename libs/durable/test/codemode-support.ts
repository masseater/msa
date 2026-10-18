import { type AssistantMessage, fauxAssistantMessage, fauxText, fauxToolCall } from "@msa/ai";
import { type Harness, type TaskId, ToolResultEntry, type ToolTaskInput } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import { type CodemodeToolDetails } from "../src/codemode/codemode.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, type ChatSetup, openChat } from "./chat-support.ts";
import { codemodeChat } from "./codemode-chat-support.ts";
import { awaited } from "./effect-support.ts";
import { makeTempDir, makeTempFile, removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";

export const DONE = fauxAssistantMessage([fauxText("done")]);

export function script(code: string): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall("codemode", { code }, { id: "s1" })], {
    stopReason: "toolUse",
  });
}

export const directories = new Set<string>();

export function removeDirectories(): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  );
}

export const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const { directory, path } = yield* makeTempFile("msa-durable-codemode-", "session.sqlite");
  directories.add(directory);
  return path;
});

export const openStoredChat = Effect.fn("openStoredChat")(function* (
  path: string,
  setup: ChatSetup,
  options?: Parameters<typeof openChat>[2],
) {
  return yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup, options);
});

export const envDirectory = Effect.fn("envDirectory")(function* () {
  const cwd = yield* makeTempDir("msa-codemode-env-");
  directories.add(cwd);
  return cwd;
});

export const resultDetails = Effect.fn("resultDetails")(function* (
  root: Effect.Success<ReturnType<typeof openChat>>["root"],
) {
  const entry = (yield* allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  return (entry.model![0] as { details?: CodemodeToolDetails }).details;
});

export const scriptTask = Effect.fn("scriptTask")(function* (harness: Harness) {
  const tasks = (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context),
  )).items;
  return tasks.find((task) => (task.input as ToolTaskInput).kind === "model")!.id;
});

export const nestedCount = Effect.fn("nestedCount")(function* (harness: Harness) {
  const tasks = (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context),
  )).items;
  return tasks.filter((task) => (task.input as ToolTaskInput).kind === "nested").length;
});

export const resultText = Effect.fn("resultText")(function* (
  setup: ChatSetup,
  root: Effect.Success<ReturnType<typeof openChat>>["root"],
) {
  void setup;
  const entry = (yield* allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  const message = entry.model![0]!;
  return {
    text:
      message.role === "toolResult"
        ? message.content
            .map((item) => (item.type === "text" ? item.text : ""))
            .join("")
            .replace(/^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n/u, "")
        : "",
    isError: message.role === "toolResult" && message.isError,
  };
});

export const restart = Effect.fn("restart")(function* (
  chat: ReturnType<typeof codemodeChat>,
  code: string,
  between: (harness: Harness, task: TaskId) => Promise<void> = () => Promise.resolve(),
  beforeClose: (harness: Harness, task: TaskId) => Promise<void> = () => Promise.resolve(),
) {
  const path = yield* sqlitePath();
  chat.setup.faux.setResponses([script(code), DONE]);
  let opened = yield* openStoredChat(path, chat.setup);
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(chat.holds.reached.promise);
  yield* awaited(beforeClose(opened.harness, yield* scriptTask(opened.harness)));
  yield* awaited(opened.harness.close(context));
  chat.holds.block = false;
  opened = yield* openStoredChat(path, chat.setup);
  yield* awaited(between(opened.harness, yield* scriptTask(opened.harness)));
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  return { ...opened, result: yield* resultText(chat.setup, opened.root) };
});

export const runScript = Effect.fn("runScript")(function* (code: string, chat = codemodeChat()) {
  chat.holds.block = false;
  const cwd = yield* envDirectory();
  chat.setup.faux.setResponses([script(code), DONE]);
  const { harness, root } = yield* openStoredChat(yield* sqlitePath(), chat.setup, {
    env: new NodeExecutionEnv({ cwd }),
  });
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  const entry = (yield* allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  const model = entry.model![0];
  const message = {
    ...(model as { content: { type: string; text?: string }[]; isError: boolean }),
    details: (model as { details?: CodemodeToolDetails }).details,
  };
  yield* awaited(harness.close(context));
  return { text: message.content.map((item) => item.text ?? `<${item.type}>`).join(""), message };
});
