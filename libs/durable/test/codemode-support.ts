import { type AssistantMessage, fauxAssistantMessage, fauxText, fauxToolCall } from "@msa/ai";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import type codemodeTypes from "../src/codemode/codemode.types.ts";
import codemodeChatSupport from "./codemode-chat-support.ts";
import durableKit from "./durable-kit.ts";
import support from "./support.ts";

const { durable, envNode: nodeModule, sqliteNode: node } = durableKit;

const { openNodeSqliteStorage } = node;
const { ToolResultEntry } = durable;
const { ToolTask } = harnessModule;
const { NodeExecutionEnv } = nodeModule;

const { codemodeChat } = codemodeChatSupport;
const { allEntries, awaited, context, makeTempDir, makeTempFile, openChat, removeDir } = support;

const DONE = fauxAssistantMessage([fauxText("done")]);

function script(code: string): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall("codemode", { code }, { id: "s1" })], {
    stopReason: "toolUse",
  });
}

const directories = new Set<string>();

function removeDirectories(): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  );
}

const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const { directory, path } = yield* makeTempFile("msa-durable-codemode-", "session.sqlite");
  directories.add(directory);
  return path;
});

const openStoredChat = Effect.fn("openStoredChat")(function* (
  path: string,
  setup: ReturnType<typeof support.chatSetup>,
  options?: Parameters<typeof openChat>[2],
) {
  return yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup, options);
});

const envDirectory = Effect.fn("envDirectory")(function* () {
  const cwd = yield* makeTempDir("msa-codemode-env-");
  directories.add(cwd);
  return cwd;
});

const resultDetails = Effect.fn("resultDetails")(function* (
  root: Effect.Success<ReturnType<typeof openChat>>["root"],
) {
  const entry = (yield* allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  return (entry.model![0] as { details?: codemodeTypes.CodemodeToolDetails }).details;
});

const scriptTask = Effect.fn("scriptTask")(function* (harness: durableTypes.Harness) {
  const tasks = (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context),
  )).items;
  return tasks.find((task) => (task.input as durableTypes.ToolTaskInput).kind === "model")!.id;
});

const nestedCount = Effect.fn("nestedCount")(function* (harness: durableTypes.Harness) {
  const tasks = (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context),
  )).items;
  return tasks.filter((task) => (task.input as durableTypes.ToolTaskInput).kind === "nested")
    .length;
});

const resultText = Effect.fn("resultText")(function* (
  setup: ReturnType<typeof support.chatSetup>,
  root: Effect.Success<ReturnType<typeof openChat>>["root"],
) {
  void setup;
  const entry = (yield* allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  const message = entry.model![0]!;
  return {
    isError: message.role === "toolResult" && message.isError,
    text:
      message.role === "toolResult"
        ? message.content
            .map((item) => (item.type === "text" ? item.text : ""))
            .join("")
            .replace(/^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n/u, "")
        : "",
  };
});

const restart = Effect.fn("restart")(function* (
  chat: ReturnType<typeof codemodeChat>,
  code: string,
  between: (harness: durableTypes.Harness, task: durableTypes.TaskId) => Effect.Effect<void> = () =>
    Effect.void,
  beforeClose: (
    harness: durableTypes.Harness,
    task: durableTypes.TaskId,
  ) => Effect.Effect<void> = () => Effect.void,
) {
  const path = yield* sqlitePath();
  chat.setup.faux.setResponses([script(code), DONE]);
  let opened = yield* openStoredChat(path, chat.setup);
  const id = (yield* awaited(opened.root.submit({ content: "go", type: "input" }, context))).id;
  yield* awaited(chat.holds.reached.promise);
  yield* beforeClose(opened.harness, yield* scriptTask(opened.harness));
  yield* awaited(opened.harness.close(context));
  chat.holds.block = false;
  opened = yield* openStoredChat(path, chat.setup);
  yield* between(opened.harness, yield* scriptTask(opened.harness));
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  return { ...opened, result: yield* resultText(chat.setup, opened.root) };
});

const runScript = Effect.fn("runScript")(function* (code: string, chat = codemodeChat()) {
  chat.holds.block = false;
  const cwd = yield* envDirectory();
  chat.setup.faux.setResponses([script(code), DONE]);
  const { harness, root } = yield* openStoredChat(yield* sqlitePath(), chat.setup, {
    env: new NodeExecutionEnv({ cwd }),
  });
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const entry = (yield* allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  const model = entry.model![0];
  const message = {
    ...(model as { content: { type: string; text?: string }[]; isError: boolean }),
    details: (model as { details?: codemodeTypes.CodemodeToolDetails }).details,
  };
  yield* awaited(harness.close(context));
  return { message, text: message.content.map((item) => item.text ?? `<${item.type}>`).join("") };
});

const codemodeSupport = {
  DONE,
  directories,
  envDirectory,
  nestedCount,
  openStoredChat,
  removeDirectories,
  restart,
  resultDetails,
  resultText,
  runScript,
  script,
  scriptTask,
  sqlitePath,
};

export default codemodeSupport;
