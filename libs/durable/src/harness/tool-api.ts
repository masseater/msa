import { awaitWithContext, type Context } from "@msa/chord/context";
import { copyJson, type JsonValue } from "@msa/chord/json";
import { PROGRESS_BYTES_PER_SECOND, type Progress } from "@msa/chord/progress";
import { Effect } from "effect";

import { checkKey } from "./tool-call.ts";
import { startNestedCall } from "./tool-nested.ts";
import { copyDiagnostic } from "./tool-progress.ts";
import { fallbackResult } from "./tool-result.ts";
import {
  NestedCallDoc,
  type Reported,
  type ToolRuntime,
  type ToolTaskResult,
} from "./tool-types.ts";
import type {
  JsonObject,
  NestedToolExecutionResult,
  Task,
  TaskId,
  TaskOptions,
  ToolDiagnostic,
  ToolExecutionApi,
  ToolHookCall,
  Tx,
} from "./types.ts";

export type ApiState = {
  readonly admissions: Promise<unknown>[];
  ended: boolean;
  sequence: number;
  madeNestedMemo: Promise<unknown> | undefined;
};

export const newApiState = (): ApiState => ({
  admissions: [],
  ended: false,
  sequence: 0,
  madeNestedMemo: undefined,
});

type ApiInput = {
  readonly runtime: ToolRuntime;
  readonly call: ToolHookCall;
  readonly reported: Reported;
  readonly progress: Progress;
  readonly state: ApiState;
  readonly resumes: boolean;
};

const outputWindowOf = (input: ApiInput): ToolExecutionApi["outputWindow"] =>
  input.reported.limits.retain === "tail"
    ? {
        maxBytes: input.reported.limits.maxBytes,
        maxLines: input.reported.limits.maxLines,
        minIntervalMs: input.runtime.settings.progress.outputIntervalMs,
        bytesPerSecond: PROGRESS_BYTES_PER_SECOND,
      }
    : undefined;

const readNested = Effect.fnUntraced(function* (
  runtime: ToolRuntime,
  id: TaskId<ToolTaskResult>,
  name: string,
  key: string,
  context: Context,
) {
  const settled = yield* Effect.promise(() => runtime.waitForTask(id, context));
  const stored = (yield* Effect.promise(() =>
    runtime.snapshot(NestedCallDoc, runtime.taskId, key, context),
  ))?.result;
  return stored === undefined
    ? fallbackResult(id, name, settled.state.outcome)
    : (copyJson(stored as unknown as JsonValue) as unknown as NestedToolExecutionResult);
});

const nestedCall = (
  input: ApiInput,
  name: string,
  args: JsonObject,
  options: { readonly key?: string; readonly progress?: boolean },
  context: Context,
): Promise<NestedToolExecutionResult> => {
  const { runtime, state, call } = input;
  const key = options.key ?? String(++state.sequence);
  if (options.key !== undefined) checkKey(options.key);
  state.madeNestedMemo ??= runtime
    .memo("msa.tool.madeNestedCalls", true, context)
    .catch((error: unknown) => {
      state.madeNestedMemo = undefined;
      throw error;
    });
  const admission = state.madeNestedMemo.then(() =>
    Effect.runPromise(
      startNestedCall(
        runtime,
        call.id,
        name,
        args,
        { key, progress: options.progress, abandonOnRestart: !input.resumes },
        context,
      ),
    ),
  );
  state.admissions.push(admission);
  return admission.then((id) => Effect.runPromise(readNested(runtime, id, name, key, context)));
};

const commitCapturing = <T>(
  runtime: ToolRuntime,
  change: (tx: Tx) => T | Promise<T>,
  context: Context,
): Promise<T> => {
  const captured: { value?: T } = {};
  const run = (tx: Tx): Promise<undefined> =>
    Effect.runPromise(
      Effect.map(
        Effect.promise(() => Promise.resolve(change(tx))),
        (value) => {
          captured.value = value;
          return undefined;
        },
      ),
    );
  return Effect.runPromise(
    Effect.map(
      Effect.promise(() => runtime.commit(run, context)),
      () => captured.value as T,
    ),
  );
};

type Live = () => void;

const outputApi = (input: ApiInput, assertLive: Live) => {
  const { reported, progress } = input;
  return {
    output: (chunk: string, skipped?: Parameters<ToolExecutionApi["output"]>[1]) => {
      assertLive();
      if (reported.output.push(chunk, skipped)) progress.mark();
    },
    outputWindow: outputWindowOf(input),
    retainedOutput: () => {
      assertLive();
      const retained = reported.output.snapshot();
      return { text: retained.text, truncated: retained.droppedBytes > 0 };
    },
    diagnostic: (diagnostic: ToolDiagnostic) => {
      assertLive();
      reported.diagnostics.push(copyDiagnostic(diagnostic));
      progress.mark();
    },
    details: (value: JsonValue, detailsContext: Context) =>
      Effect.runPromise(
        Effect.flatMap(
          Effect.sync(() => {
            assertLive();
            detailsContext.abortSignal?.throwIfAborted();
            reported.details = copyJson(value, { omitUndefinedProperties: true });
            const committed = progress.markAndWait();
            committed.catch(() => undefined);
            return { committed };
          }),
          ({ committed }) => Effect.promise(() => awaitWithContext(committed, detailsContext)),
        ),
      ),
  } satisfies Partial<ToolExecutionApi>;
};

const taskApi = (input: ApiInput) => {
  const { runtime } = input;
  return {
    commit: <T>(change: (tx: Tx) => T | Promise<T>, commitContext: Context): Promise<T> =>
      commitCapturing(runtime, change, commitContext),
    memo: runtime.memo,
    createTask: <I, S extends { phase: string }, R, H extends object>(
      task: Task<I, S, R, H>,
      taskInput: I,
      options: Omit<TaskOptions, "conversationId">,
      taskContext: Context,
    ): Promise<TaskId<R>> => {
      const child =
        options.ownership.kind === "task" && !input.resumes
          ? { abandonOnRestart: true, ...options }
          : options;
      return commitCapturing(runtime, (tx) => tx.createTask(task, taskInput, child), taskContext);
    },
    getTask: runtime.getTask,
    waitForTask: runtime.waitForTask,
    conversation: runtime.conversation,
    snapshot: runtime.snapshot,
    snapshotAsOf: runtime.snapshotAsOf,
    watchDoc: runtime.watchDoc,
  };
};

export const buildApi = (input: ApiInput): Omit<ToolExecutionApi, "env"> => {
  const { runtime, call, state } = input;
  const assertLive = (): void => {
    if (state.ended) throw new Error(`Tool call ${call.id} has settled`);
  };
  return {
    taskId: runtime.taskId,
    conversationId: runtime.conversationId,
    callId: call.id,
    registry: runtime.registry,
    agent: runtime.agent,
    models: runtime.models,
    ...outputApi(input, assertLive),
    ...taskApi(input),
    executeTool: (name, toolArgs, callContext, options = {}) =>
      Effect.runPromise(
        Effect.promise(() => {
          assertLive();
          return nestedCall(input, name, toolArgs, options, callContext);
        }),
      ),
  };
};
