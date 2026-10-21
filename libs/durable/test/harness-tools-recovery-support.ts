import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type envTypes from "../src/env/index.types.ts";
import node from "../src/storage/sqlite/node.ts";
import support from "./support.ts";
import type supportTypes from "./support.types.ts";

const { Type, fauxAssistantMessage, fauxText, fauxToolCall } = ai;

const { openNodeSqliteStorage } = node;
const { LiveDoc, ToolResultEntry, defineTool } = durable;

const { aborted, awaited, context, deferred, makeTempFile, openChat, removeDir, waitFor } = support;

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
  const { directory, path } = yield* makeTempFile("msa-durable-tools-", "session.sqlite");
  directories.add(directory);
  return path;
});

const open = Effect.fn("open")(function* (
  path: string,
  setup: supportTypes.ChatSetup,
  env?: envTypes.ExecutionEnv,
) {
  const opened = yield* openChat(
    yield* awaited(openNodeSqliteStorage(path)),
    setup,
    env === undefined ? {} : { env },
  );
  opened.harness.resume();
  return opened;
});

function toolImpl(
  name: string,
  execute: durableTypes.ToolRegistration["execute"],
  extra: Partial<durableTypes.ToolRegistration> = {},
): durableTypes.ToolRegistration {
  return defineTool({ description: name, execute, name, parameters: Type.Object({}), ...extra });
}

const tool: {
  (
    execute: durableTypes.ToolRegistration["execute"],
    extra?: Partial<durableTypes.ToolRegistration>,
  ): (name: string) => ReturnType<typeof toolImpl>;
  (
    name: string,
    execute: durableTypes.ToolRegistration["execute"],
    extra?: Partial<durableTypes.ToolRegistration>,
  ): ReturnType<typeof toolImpl>;
} = dual((args) => typeof args[0] === "string", toolImpl);

function call(name: string): aiTypes.AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, {}, { id: "c1" })], { stopReason: "toolUse" });
}

const DONE = fauxAssistantMessage([fauxText("done")]);

function results(entries: readonly durableTypes.EntryRecord[]): aiTypes.ToolResultMessage[] {
  return entries
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => entry.model![0] as aiTypes.ToolResultMessage);
}

function text(message: aiTypes.ToolResultMessage | undefined): string {
  return (message?.content ?? []).map((item) => (item.type === "text" ? item.text : "")).join("|");
}

const toolTaskId = Effect.fn("toolTaskId")(function* (harness: durableTypes.Harness) {
  let id: durableTypes.TaskId | undefined;
  yield* waitFor(
    Effect.gen(function* () {
      id = (yield* awaited(harness.snapshot(LiveDoc, 1 as never, context)))?.tools?.[0]?.taskId;
      return id !== undefined;
    }),
  );
  return id!;
});

function blockingToolImpl(name: string, extra: Partial<durableTypes.ToolRegistration> = {}) {
  const started = deferred();
  const state = { blocking: 1, runs: 0 };
  const registration = tool(
    name,
    (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          state.runs++;
          api.output(`run ${state.runs}\n`);
          yield* awaited(api.details({ run: state.runs }, callContext));
          if (state.runs <= state.blocking) {
            started.resolve();
            return yield* awaited(aborted(callContext.abortSignal!));
          }
          return {};
        }),
      ),
    extra,
  );
  return { registration, started, state };
}

const blockingTool: {
  (
    extra?: Partial<durableTypes.ToolRegistration>,
  ): (name: string) => ReturnType<typeof blockingToolImpl>;
  (
    name: string,
    extra?: Partial<durableTypes.ToolRegistration>,
  ): ReturnType<typeof blockingToolImpl>;
} = dual((args) => typeof args[0] === "string", blockingToolImpl);

const harnessToolsRecoverySupport = {
  DONE,
  blockingTool,
  call,
  directories,
  open,
  removeDirectories,
  results,
  sqlitePath,
  text,
  tool,
  toolTaskId,
};

export default harnessToolsRecoverySupport;
