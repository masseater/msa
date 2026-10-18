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
  type EntryRecord,
  type Harness,
  LiveDoc,
  type TaskId,
  type ToolRegistration,
  ToolResultEntry,
} from "@msa/durable";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type { ExecutionEnv } from "../src/env/index.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import {
  type ChatSetup,
  openChat,
  waitFor,
  awaited,
  makeTempFile,
  removeDir,
  context,
  aborted,
  deferred,
} from "./support.ts";

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
  const { directory, path } = yield* makeTempFile("msa-durable-tools-", "session.sqlite");
  directories.add(directory);
  return path;
});

export const open = Effect.fn("open")(function* (
  path: string,
  setup: ChatSetup,
  env?: ExecutionEnv,
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
  execute: ToolRegistration["execute"],
  extra: Partial<ToolRegistration> = {},
): ToolRegistration {
  return defineTool({ name, description: name, parameters: Type.Object({}), execute, ...extra });
}

export const tool: {
  (
    execute: ToolRegistration["execute"],
    extra?: Partial<ToolRegistration>,
  ): (name: string) => ReturnType<typeof toolImpl>;
  (
    name: string,
    execute: ToolRegistration["execute"],
    extra?: Partial<ToolRegistration>,
  ): ReturnType<typeof toolImpl>;
} = dual((args) => typeof args[0] === "string", toolImpl);

export function call(name: string): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, {}, { id: "c1" })], { stopReason: "toolUse" });
}

export const DONE = fauxAssistantMessage([fauxText("done")]);

export function results(entries: readonly EntryRecord[]): ToolResultMessage[] {
  return entries
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => entry.model![0] as ToolResultMessage);
}

export function text(message: ToolResultMessage | undefined): string {
  return (message?.content ?? []).map((item) => (item.type === "text" ? item.text : "")).join("|");
}

export const toolTaskId = Effect.fn("toolTaskId")(function* (harness: Harness) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let id: TaskId | undefined;
  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        id = (yield* awaited(harness.snapshot(LiveDoc, 1 as never, context)))?.tools?.[0]?.taskId;
        return id !== undefined;
      }),
    ),
  );
  return id!;
});

function blockingToolImpl(name: string, extra: Partial<ToolRegistration> = {}) {
  const started = deferred();
  const state = { runs: 0, blocking: 1 };
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

export const blockingTool: {
  (extra?: Partial<ToolRegistration>): (name: string) => ReturnType<typeof blockingToolImpl>;
  (name: string, extra?: Partial<ToolRegistration>): ReturnType<typeof blockingToolImpl>;
} = dual((args) => typeof args[0] === "string", blockingToolImpl);
