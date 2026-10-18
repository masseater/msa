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
  type ToolTaskInput,
} from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, type ChatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addTool } from "./harness-support.ts";
import { joinPath, makeTempDir } from "./platform-support.ts";
import { context } from "./session-support.ts";

export const Parameters = Type.Object({ text: Type.Optional(Type.String()) });

function toolImpl(
  name: string,
  execute: ToolRegistration<typeof Parameters>["execute"],
  extra: Partial<ToolRegistration<typeof Parameters>> = {},
): ToolRegistration<typeof Parameters> {
  return defineTool({ name, description: name, parameters: Parameters, execute, ...extra });
}

export const tool: {
  (
    execute: ToolRegistration<typeof Parameters>["execute"],
    extra?: Partial<ToolRegistration<typeof Parameters>>,
  ): (name: string) => ReturnType<typeof toolImpl>;
  (
    name: string,
    execute: ToolRegistration<typeof Parameters>["execute"],
    extra?: Partial<ToolRegistration<typeof Parameters>>,
  ): ReturnType<typeof toolImpl>;
} = dual((args) => typeof args[0] === "string", toolImpl);

export function call(name: string): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, {}, { id: "c1" })], { stopReason: "toolUse" });
}

export const DONE = fauxAssistantMessage([fauxText("done")]);

export const directories = new Set<string>();

export const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-nested-restart-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});

export const open = Effect.fn("open")(function* (path: string, setup: ChatSetup) {
  return yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
});

export const nestedTasks = Effect.fn("nestedTasks")(function* (harness: Harness) {
  const tasks = (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context),
  )).items;
  return tasks.filter((task) => (task.input as ToolTaskInput).kind === "nested");
});

export function results(
  entries: Effect.Success<ReturnType<typeof allEntries>>,
): ToolResultMessage[] {
  return entries
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => entry.model![0] as ToolResultMessage);
}

export function codes(result: NestedToolExecutionResult | undefined): string[] {
  return (result?.diagnostics ?? []).flatMap((diagnostic) =>
    diagnostic.code === undefined ? [] : [diagnostic.code],
  );
}

function spawnThroughBatchImpl(
  setup: ChatSetup,
  Worker: Task<null, { phase: "work" }, null, object>,
) {
  const spawned: { worker?: TaskId } = {};
  addTool(
    setup.registry,
    tool("spawn", (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          spawned.worker = yield* awaited(
            api.createTask(
              Worker,
              null,
              { ownership: { kind: "task", taskId: api.taskId } },
              callContext,
            ),
          );
          yield* awaited(api.waitForTask(spawned.worker, callContext));
          return {};
        }),
      ),
    ),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* awaited(api.executeTool("spawn", {}, callContext));
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return spawned;
}

export const spawnThroughBatch: {
  (
    Worker: Task<null, { phase: "work" }, null, object>,
  ): (setup: ChatSetup) => ReturnType<typeof spawnThroughBatchImpl>;
  (
    setup: ChatSetup,
    Worker: Task<null, { phase: "work" }, null, object>,
  ): ReturnType<typeof spawnThroughBatchImpl>;
} = dual(2, spawnThroughBatchImpl);

export const restartDuring = Effect.fn("restartDuring")(function* (
  path: string,
  setup: ChatSetup,
  reached: Promise<unknown>,
) {
  const first = yield* open(path, setup);
  const id = (yield* awaited(first.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(reached);
  yield* awaited(first.harness.close(context));
  return { opened: yield* open(path, setup), id };
});
