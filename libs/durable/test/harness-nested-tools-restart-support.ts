import {
  type AssistantMessage,
  type ToolResultMessage,
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@msa/ai";
import {
  type Harness,
  type NestedToolExecutionResult,
  type Task,
  type TaskId,
  type ToolRegistration,
  ToolResultEntry,
  type ToolTaskInput,
  defineTool,
} from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import support from "./support.ts";
import type supportTypes from "./support.types.ts";

const { addTool, allEntries, awaited, context, joinPath, makeTempDir, openChat } = support;

const Parameters = Type.Object({ text: Type.Optional(Type.String()) });

function toolImpl(
  name: string,
  execute: ToolRegistration<typeof Parameters>["execute"],
  extra: Partial<ToolRegistration<typeof Parameters>> = {},
): ToolRegistration<typeof Parameters> {
  return defineTool({ description: name, execute, name, parameters: Parameters, ...extra });
}

const tool: {
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

function call(name: string): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, {}, { id: "c1" })], { stopReason: "toolUse" });
}

const DONE = fauxAssistantMessage([fauxText("done")]);

const directories = new Set<string>();

const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-nested-restart-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});

const open = Effect.fn("open")(function* (path: string, setup: supportTypes.ChatSetup) {
  return yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
});

const nestedTasks = Effect.fn("nestedTasks")(function* (harness: Harness) {
  const tasks = (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context),
  )).items;
  return tasks.filter((task) => (task.input as ToolTaskInput).kind === "nested");
});

function results(entries: Effect.Success<ReturnType<typeof allEntries>>): ToolResultMessage[] {
  return entries
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => entry.model![0] as ToolResultMessage);
}

function codes(result: NestedToolExecutionResult | undefined): string[] {
  return (result?.diagnostics ?? []).flatMap((diagnostic) =>
    diagnostic.code === undefined ? [] : [diagnostic.code],
  );
}

function spawnThroughBatchImpl(
  setup: supportTypes.ChatSetup,
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

const spawnThroughBatch: {
  (
    Worker: Task<null, { phase: "work" }, null, object>,
  ): (setup: supportTypes.ChatSetup) => ReturnType<typeof spawnThroughBatchImpl>;
  (
    setup: supportTypes.ChatSetup,
    Worker: Task<null, { phase: "work" }, null, object>,
  ): ReturnType<typeof spawnThroughBatchImpl>;
} = dual(2, spawnThroughBatchImpl);

const restartDuring = Effect.fn("restartDuring")(function* (
  path: string,
  setup: supportTypes.ChatSetup,
  reached: Promise<unknown>,
) {
  const first = yield* open(path, setup);
  const id = (yield* awaited(first.root.submit({ content: "go", type: "input" }, context))).id;
  yield* awaited(reached);
  yield* awaited(first.harness.close(context));
  return { id, opened: yield* open(path, setup) };
});

const harnessNestedToolsRestartSupport = {
  DONE,
  Parameters,
  call,
  codes,
  directories,
  nestedTasks,
  open,
  restartDuring,
  results,
  spawnThroughBatch,
  sqlitePath,
  tool,
};

export default harnessNestedToolsRestartSupport;
