import { type Context, awaitWithContext } from "@msa/chord/context";
import { type JsonValue, copyJson } from "@msa/chord/json";
import { PROGRESS_BYTES_PER_SECOND, type Progress } from "@msa/chord/progress";
import { Effect } from "effect";

import toolApiKit from "./tool-api-kit.ts";
import type toolApiTypes from "./tool-api.types.ts";
import toolTypes from "./tool-types.ts";
import type toolTypesModule from "./tool-types.types.ts";
import type typesModule from "./types.types.ts";
const { NestedCallDoc } = toolTypes;
const { fallbackResult } = toolApiKit.toolResult;
const { checkKey } = toolApiKit.toolCall;
const { startNestedCall } = toolApiKit.toolNested;
const { copyDiagnostic } = toolApiKit.toolProgress;

const newApiState = (): toolApiTypes.ApiState => ({
  admissions: [],
  ended: false,
  madeNestedMemo: undefined,
  sequence: 0,
});

type ApiInput = {
  readonly runtime: toolTypesModule.ToolRuntime;
  readonly call: typesModule.ToolHookCall;
  readonly reported: toolTypesModule.Reported;
  readonly progress: Progress;
  readonly state: toolApiTypes.ApiState;
  readonly resumes: boolean;
};

const outputWindowOf = (input: ApiInput): typesModule.ToolExecutionApi["outputWindow"] =>
  input.reported.limits.retain === "tail"
    ? {
        bytesPerSecond: PROGRESS_BYTES_PER_SECOND,
        maxBytes: input.reported.limits.maxBytes,
        maxLines: input.reported.limits.maxLines,
        minIntervalMs: input.runtime.settings.progress.outputIntervalMs,
      }
    : undefined;

const readNested = Effect.fnUntraced(function* (
  runtime: toolTypesModule.ToolRuntime,
  id: typesModule.TaskId<toolTypesModule.ToolTaskResult>,
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
    : (copyJson(
        stored as unknown as JsonValue,
      ) as unknown as typesModule.NestedToolExecutionResult);
});

const nestedCall = (
  input: ApiInput,
  name: string,
  args: typesModule.JsonObject,
  options: { readonly key?: string; readonly progress?: boolean },
  context: Context,
): Promise<typesModule.NestedToolExecutionResult> => {
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
        { abandonOnRestart: !input.resumes, key, progress: options.progress },
        context,
      ),
    ),
  );
  state.admissions.push(admission);
  return admission.then((id) => Effect.runPromise(readNested(runtime, id, name, key, context)));
};

const commitCapturing = <T>(
  runtime: toolTypesModule.ToolRuntime,
  change: (tx: typesModule.Tx) => T | Promise<T>,
  context: Context,
): Promise<T> => {
  const captured: { value?: T } = {};
  const run = (tx: typesModule.Tx): Promise<undefined> =>
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
    diagnostic: (diagnostic: typesModule.ToolDiagnostic) => {
      assertLive();
      reported.diagnostics.push(copyDiagnostic(diagnostic));
      progress.mark();
    },
    output: (chunk: string, skipped?: Parameters<typesModule.ToolExecutionApi["output"]>[1]) => {
      assertLive();
      if (reported.output.push(chunk, skipped)) progress.mark();
    },
    outputWindow: outputWindowOf(input),
    retainedOutput: () => {
      assertLive();
      const retained = reported.output.snapshot();
      return { text: retained.text, truncated: retained.droppedBytes > 0 };
    },
  } satisfies Partial<typesModule.ToolExecutionApi>;
};

const taskApi = (input: ApiInput) => {
  const { runtime } = input;
  return {
    commit: <T>(
      change: (tx: typesModule.Tx) => T | Promise<T>,
      commitContext: Context,
    ): Promise<T> => commitCapturing(runtime, change, commitContext),
    conversation: runtime.conversation,
    createTask: <I, S extends { phase: string }, R, H extends object>(
      task: typesModule.Task<I, S, R, H>,
      taskInput: I,
      options: Omit<typesModule.TaskOptions, "conversationId">,
      taskContext: Context,
    ): Promise<typesModule.TaskId<R>> => {
      const child =
        options.ownership.kind === "task" && !input.resumes
          ? { abandonOnRestart: true, ...options }
          : options;
      return commitCapturing(runtime, (tx) => tx.createTask(task, taskInput, child), taskContext);
    },
    getTask: runtime.getTask,
    memo: runtime.memo,
    snapshot: runtime.snapshot,
    snapshotAsOf: runtime.snapshotAsOf,
    waitForTask: runtime.waitForTask,
    watchDoc: runtime.watchDoc,
  };
};

const buildApi = (input: ApiInput): Omit<typesModule.ToolExecutionApi, "env"> => {
  const { runtime, call, state } = input;
  const assertLive = (): void => {
    if (state.ended) throw new Error(`Tool call ${call.id} has settled`);
  };
  return {
    agent: runtime.agent,
    callId: call.id,
    conversationId: runtime.conversationId,
    models: runtime.models,
    registry: runtime.registry,
    taskId: runtime.taskId,
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

const toolApi = {
  buildApi,
  newApiState,
};

export default toolApi;
