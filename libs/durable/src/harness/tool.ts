import type { ImageContent, TextContent, ToolCall, ToolResultMessage } from "@msa/ai";
import { validateToolArguments } from "@msa/ai/utils/validation";
import {
  type Context,
  copyJson,
  type Draft,
  type JsonRepresentation,
  type JsonValue,
} from "@msa/chord";
import { awaitWithContext } from "@msa/chord/context";
import { overlap } from "@msa/chord/delta";
import {
  boundOutput,
  OutputBuffer,
  type OutputLimits,
  PROGRESS_BYTES_PER_SECOND,
  Progress,
} from "@msa/chord/output";
import { Compile } from "typebox/compile";

import { defineDocFamily } from "../documents.ts";
import { AssistantEntry, ToolResultEntry } from "../entries.ts";
import { errorMessage } from "../errors.ts";
import { promiseTry } from "../promise-try.ts";
import { defineTask } from "../tasks.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, utf8ByteLength } from "../truncate.ts";
import type {
  ConversationId,
  EntryId,
  JsonObject,
  Task,
  TaskId,
  TaskOptions,
  TaskOutcome,
  TaskRuntime,
  Tx,
  TypedEntry,
} from "../types.ts";
import { assignJson } from "./json.ts";
import {
  clearProgress,
  finishSlot,
  LiveDoc,
  type NestedToolSlot,
  type NestedToolSummary,
  removeNestedSlots,
  type ToolSlot,
  toolSlot,
} from "./live.ts";
import type {
  NestedToolExecutionResult,
  ToolControl,
  ToolDiagnostic,
  ToolExecutionApi,
  ToolExecutionResult,
  ToolHookCall,
  ToolHooks,
  ToolRegistration,
} from "./types.ts";
import { recordUsage } from "./usage.ts";

export type ToolTaskInput =
  | { kind: "model"; assistant: EntryId; callId: string }
  | {
      kind: "nested";
      parent: TaskId;
      parentCallId: string;
      key: string;
      call: ToolCall;
      progress?: false;
    };

export type ToolTaskCheckpoint =
  | { phase: "call" }
  | { phase: "execute"; arguments: JsonObject; replay: "safe" | "unsafe" };

export type ToolTaskResult =
  | { kind: "model"; entryId: EntryId; control?: ToolControl }
  | { kind: "nested" };

const MADE_NESTED_CALLS = "msa.tool.madeNestedCalls";

export type NestedCallState = {
  taskId?: TaskId<ToolTaskResult>;
  result?: JsonRepresentation<NestedToolExecutionResult>;
};

export const NestedCallDoc = defineDocFamily<NestedCallState, null>({
  kind: "msa.tool.nested-call",
  version: 1,
  scope: "task",
  family: true,
  initial: () => ({}),
});

type Runtime = TaskRuntime<ToolTaskInput, ToolTaskCheckpoint, ToolTaskResult, ToolHooks>;
type Content = (TextContent | ImageContent)[];

export const ToolTask = defineTask<ToolTaskInput, ToolTaskCheckpoint, ToolTaskResult, ToolHooks>({
  name: "msa.tool",
  version: 2,
  initial: () => ({ phase: "call" }),
  migrate: (input, checkpoint) => ({
    input: { kind: "model", ...(input as { assistant: EntryId; callId: string }) },
    checkpoint: checkpoint as ToolTaskCheckpoint,
  }),
  phases: {
    call: async (task, runtime, context) => {
      const call = await readCall(runtime, task.input, context);
      const tool = await resolveTool(runtime, task.input, call.name, context);
      if (tool === undefined) {
        const error = harnessError("tool_unavailable", `Tool ${call.name} is not available`);
        return settle(runtime, task.input, call, COMPLETED, () => error, context);
      }
      const prepared = prepare(tool, call.arguments as JsonObject);
      const checked = "error" in prepared ? prepared : validate(tool, call, prepared.args);
      if ("error" in checked)
        return settle(runtime, task.input, call, COMPLETED, () => invalid(checked.error), context);
      let args = checked.args;
      let block: string | undefined;
      await runtime.hooks.each("beforeTool", async (hook) => {
        if (block !== undefined) return;
        try {
          const decision = await hook({ ...call, arguments: args }, runtime, context);
          if (decision?.block !== undefined) block = decision.block;
          else if (decision?.arguments !== undefined) args = decision.arguments;
        } catch (error) {
          if (runtime.signal.aborted) throw error;
          block = errorMessage(error);
        }
      });
      if (block !== undefined) {
        const blocked = harnessError("blocked", `Tool call blocked: ${block}`);
        return settle(runtime, task.input, call, COMPLETED, () => blocked, context);
      }
      const validated = validate(tool, call, args);
      if ("error" in validated)
        return settle(
          runtime,
          task.input,
          call,
          COMPLETED,
          () => invalid(validated.error),
          context,
        );
      const final = copyJson(validated.args, { omitUndefinedProperties: true }) as JsonObject;
      await runtime.commit(async (tx) => {
        const slot = toolSlot(await tx.doc(LiveDoc, runtime.conversationId), runtime.taskId);
        if (slot !== undefined) slot.status = "running";
        const changed =
          task.input.kind === "nested" && !jsonEqual(task.input.call.arguments as JsonValue, final);
        if (changed && slot !== undefined && "parentTaskId" in slot) slot.arguments = final;
        const intent = {
          phase: "execute",
          arguments: final,
          replay: tool.replay ?? "unsafe",
        } as const;
        return { status: "running", checkpoint: intent };
      }, context);
      await run(runtime, task.input, call, tool, final, context);
    },
    execute: async (task, runtime, context) => {
      const { checkpoint } = task.state;
      const args = checkpoint.arguments;
      const replay = checkpoint.replay;
      const call = await readCall(runtime, task.input, context);
      const tool = await resolveTool(runtime, task.input, call.name, context);
      if (replay === "safe" && tool?.replay === "safe") {
        await runtime.commit(async (tx) => {
          const slot = toolSlot(await tx.doc(LiveDoc, runtime.conversationId), runtime.taskId);
          if (slot !== undefined) clearProgress(slot);
          return undefined;
        }, context);
        return run(runtime, task.input, call, tool, args, context);
      }
      const message = `Tool ${call.name} was interrupted and may have partially run`;
      const ending = { status: "failed", message } as const;
      await settle(
        runtime,
        task.input,
        call,
        ending,
        (slot) => fromSlot(slot, "interrupted", message),
        context,
      );
    },
  },
  abort: async (task, runtime, context) => {
    const call = await readCall(runtime, task.input, context);
    const [code, message] =
      task.abortReason === "restart"
        ? task.state.checkpoint.phase === "execute"
          ? [
              "interrupted",
              `Tool ${call.name} was interrupted by a restart and may have partially run`,
            ]
          : ["abandoned", `Tool ${call.name} was not started: its caller ended with a restart`]
        : ["aborted", `Tool ${call.name} was aborted`];
    const ending = { status: "aborted" } as const;
    await settle(
      runtime,
      task.input,
      call,
      ending,
      (slot) => fromSlot(slot, code, message),
      context,
    );
  },
});

async function resolveTool(
  runtime: Runtime,
  input: ToolTaskInput,
  name: string,
  context: Context,
): Promise<ToolRegistration | undefined> {
  const agent = await runtime.agent(context);
  return (input.kind === "model" ? agent.tools : agent.callable).find((tool) => tool.name === name);
}

async function readCall(
  runtime: Runtime,
  input: ToolTaskInput,
  context: Context,
): Promise<ToolHookCall> {
  if (input.kind === "nested")
    return { ...input.call, parent: { taskId: input.parent, callId: input.parentCallId } };
  const entry = await runtime.entry(AssistantEntry, input.assistant, context);
  const message = entry?.model?.[0];
  const call =
    message?.role === "assistant"
      ? message.content.find(
          (content): content is ToolCall =>
            content.type === "toolCall" && content.id === input.callId,
        )
      : undefined;
  if (call === undefined)
    throw new Error(`Entry ${input.assistant} has no tool call ${input.callId}`);
  return call;
}

type Checked = { readonly args: JsonObject } | { readonly error: string };

function prepare(tool: ToolRegistration, args: JsonObject): Checked {
  if (tool.prepareArguments === undefined) return { args };
  try {
    return { args: tool.prepareArguments(args) as JsonObject };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function validate(tool: ToolRegistration, call: ToolCall, args: JsonObject): Checked {
  try {
    return { args: validateToolArguments(tool, { ...call, arguments: args }) as JsonObject };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function invalid(message: string): ToolExecutionResult {
  return harnessError("invalid_arguments", message);
}

type Reported = {
  readonly output: OutputBuffer;
  readonly limits: OutputLimits;
  readonly diagnostics: ToolDiagnostic[];
  details: JsonValue | undefined;
};

async function run(
  runtime: Runtime,
  input: ToolTaskInput,
  call: ToolHookCall,
  tool: ToolRegistration,
  args: JsonObject,
  context: Context,
): Promise<void> {
  const limits: OutputLimits = {
    maxBytes: tool.outputLimits?.maxBytes ?? DEFAULT_MAX_BYTES,
    maxLines: tool.outputLimits?.maxLines ?? DEFAULT_MAX_LINES,
    retain: tool.outputLimits?.retain ?? "head",
  };
  const reported: Reported = {
    output: new OutputBuffer(limits),
    limits,
    diagnostics: [],
    details: undefined,
  };
  const streams = input.kind === "model" || input.progress !== false;
  const progress = publishProgress(runtime, reported, streams, context);
  const admissions: Promise<unknown>[] = [];
  const resumes = tool.replay === "safe";
  let sequence = 0;
  let madeNestedMemo: Promise<unknown> | undefined;
  let ended = false;
  const assertLive = (): void => {
    if (ended) throw new Error(`Tool call ${call.id} has settled`);
  };
  const api: Omit<ToolExecutionApi, "env"> = {
    taskId: runtime.taskId,
    conversationId: runtime.conversationId,
    callId: call.id,
    registry: runtime.registry,
    agent: runtime.agent,
    models: runtime.models,
    output: (chunk, skipped) => {
      assertLive();
      if (reported.output.push(chunk, skipped)) progress.mark();
    },
    outputWindow:
      limits.retain === "tail"
        ? {
            maxBytes: limits.maxBytes,
            maxLines: limits.maxLines,
            minIntervalMs: runtime.settings.progress.outputIntervalMs,
            bytesPerSecond: PROGRESS_BYTES_PER_SECOND,
          }
        : undefined,
    retainedOutput: () => {
      assertLive();
      const retained = reported.output.snapshot();
      return { text: retained.text, truncated: retained.droppedBytes > 0 };
    },
    diagnostic: (diagnostic) => {
      assertLive();
      reported.diagnostics.push(
        copyJson(diagnostic, { omitUndefinedProperties: true }) as ToolDiagnostic,
      );
      progress.mark();
    },
    details: (value, detailsContext) =>
      promiseTry(() => {
        assertLive();
        detailsContext.abortSignal?.throwIfAborted();
        reported.details = copyJson(value, { omitUndefinedProperties: true });
        const committed = progress.markAndWait();
        committed.catch(() => {});
        return awaitWithContext(committed, detailsContext);
      }),
    commit: async (change, commitContext) => {
      let result: Awaited<ReturnType<typeof change>> | undefined;
      await runtime.commit(async (tx) => {
        result = await change(tx);
        return undefined;
      }, commitContext);
      return result as Awaited<ReturnType<typeof change>>;
    },
    memo: runtime.memo,
    createTask: async <I, S extends { phase: string }, R, H extends object>(
      task: Task<I, S, R, H>,
      taskInput: I,
      options: Omit<TaskOptions, "conversationId">,
      taskContext: Context,
    ): Promise<TaskId<R>> => {
      const child =
        options.ownership.kind === "task" && !resumes
          ? { abandonOnRestart: true, ...options }
          : options;
      let id: TaskId<R> | undefined;
      await runtime.commit(async (tx) => {
        id = await tx.createTask(task, taskInput, child);
        return undefined;
      }, taskContext);
      return id!;
    },
    getTask: runtime.getTask,
    waitForTask: runtime.waitForTask,
    conversation: runtime.conversation,
    snapshot: runtime.snapshot,
    snapshotAsOf: runtime.snapshotAsOf,
    watchDoc: runtime.watchDoc,
    executeTool: async (name, toolArgs, callContext, options = {}) => {
      assertLive();
      const key = options.key ?? String(++sequence);
      if (options.key !== undefined) checkKey(options.key);
      madeNestedMemo ??= runtime
        .memo(MADE_NESTED_CALLS, true, callContext)
        .catch((error: unknown) => {
          madeNestedMemo = undefined;
          throw error;
        });
      const admission = madeNestedMemo.then(() =>
        startNestedCall(
          runtime,
          call.id,
          name,
          toolArgs,
          { key, progress: options.progress, abandonOnRestart: !resumes },
          callContext,
        ),
      );
      admissions.push(admission);
      const id = await admission;
      const settled = await runtime.waitForTask(id, callContext);
      const stored = (await runtime.snapshot(NestedCallDoc, runtime.taskId, key, callContext))
        ?.result;
      return stored === undefined
        ? fallbackResult(id, name, settled.state.outcome)
        : (copyJson(stored as unknown as JsonValue) as unknown as NestedToolExecutionResult);
    },
  };

  let result: ToolExecutionResult;
  let ending = COMPLETED;
  let durationMs: number | undefined;
  try {
    const env = await runtime.env(context);
    const startedAt = performance.now();
    try {
      result = await tool.execute(args, { ...api, env }, context);
    } finally {
      durationMs = Math.round(performance.now() - startedAt);
    }
  } catch (error) {
    if (runtime.signal.aborted) {
      ended = true;
      for (const waiter of await progress.stop()) waiter.reject(error);
      throw error;
    }
    result = { isError: true, diagnostics: [toolDiagnostic("tool_error", errorMessage(error))] };
    ending = { status: "failed", message: `Tool ${call.name} threw` };
  }
  ended = true;
  await Promise.allSettled(admissions);
  reported.output.end();
  const pending = await progress.stop();
  try {
    const settled = await finalResult(runtime, input, call, tool, result, reported, context);
    await settle(runtime, input, call, ending, () => settled, context, durationMs);
  } catch (error) {
    for (const waiter of pending) waiter.reject(error);
    throw error;
  }
  for (const waiter of pending) waiter.resolve();
}

function publishProgress(
  runtime: Runtime,
  reported: Reported,
  enabled: boolean,
  context: Context,
): Progress {
  let written = { text: "", details: undefined as JsonValue | undefined, diagnostics: 0 };
  return new Progress(
    async () => {
      if (!enabled) return 0;
      const snapshot = reported.output.snapshot();
      const current = {
        text: snapshot.text,
        details: reported.details,
        diagnostics: reported.diagnostics.length,
      };
      const added = reported.diagnostics.slice(written.diagnostics, current.diagnostics);
      const detailsChanged = current.details !== written.details;
      let bytes = 0;
      if (snapshot.text !== written.text) {
        const shared = snapshot.text.startsWith(written.text)
          ? written.text.length
          : overlap(written.text, snapshot.text, 65_536);
        bytes += utf8ByteLength(snapshot.text.slice(shared));
      }
      if (detailsChanged) bytes += utf8ByteLength(JSON.stringify(current.details ?? null));
      if (added.length > 0) bytes += utf8ByteLength(JSON.stringify(added));
      await runtime.commit(async (tx) => {
        const slot = toolSlot(await tx.doc(LiveDoc, runtime.conversationId), runtime.taskId);
        if (slot === undefined) return undefined;
        if ((slot.output ?? "") !== snapshot.text) slot.output = snapshot.text;
        if (snapshot.droppedBytes > 0) slot.droppedBytes = snapshot.droppedBytes;
        if (snapshot.droppedLines > 0) slot.droppedLines = snapshot.droppedLines;
        if (detailsChanged && current.details !== undefined) {
          assignJson(slot as unknown as Record<string, JsonValue>, "details", current.details);
        }
        if (added.length > 0) {
          if (slot.diagnostics === undefined) slot.diagnostics = [];
          for (const diagnostic of added) slot.diagnostics.push(diagnostic);
        }
        return undefined;
      }, context);
      written = current;
      return bytes;
    },
    (error) => {
      if (!runtime.signal.aborted) runtime.report(error);
    },
    runtime.settings.progress.outputIntervalMs,
  );
}

async function finalResult(
  runtime: Runtime,
  input: ToolTaskInput,
  call: ToolHookCall,
  tool: ToolRegistration,
  result: ToolExecutionResult,
  reported: Reported,
  context: Context,
): Promise<ToolExecutionResult> {
  const harness: ToolDiagnostic[] = [];
  const retained = result.output === undefined ? reported.output.snapshot() : undefined;
  const output: Content =
    retained === undefined
      ? result.output!
      : retained.text === ""
        ? []
        : [{ type: "text", text: retained.text }];
  const details = result.details === undefined ? reported.details : result.details;
  let final: ToolExecutionResult = {
    ...result,
    output,
    ...(details === undefined ? {} : { details }),
    diagnostics: [...reported.diagnostics, ...(result.diagnostics ?? [])],
  };
  await runtime.hooks.each("afterTool", async (hook) => {
    final = (await hook(call, final, runtime, context)) ?? final;
  });
  if (retained !== undefined && retained.droppedBytes > 0 && final.output === output) {
    harness.push(truncated(retained, reported.limits.retain));
  }
  const bounded = boundContent(final.output ?? [], reported.limits);
  if (bounded.droppedBytes > 0) harness.push(truncated(bounded, reported.limits.retain));
  const broken = structuredOutputError(tool, final);
  if (broken !== undefined) {
    const { structuredOutput: _dropped, ...rest } = final;
    if (input.kind === "nested") {
      final = { ...rest, isError: true };
      harness.push(toolDiagnostic("invalid_structured_output", broken));
    } else {
      final = rest;
      runtime.report(new Error(broken));
    }
  }
  if (input.kind === "nested" && tool.structuredOutputSchema === undefined) {
    final = { ...final, structuredOutput: outputValue(bounded.content) as JsonValue };
  }
  if (
    input.kind === "nested" &&
    tool.structuredOutputSchema !== undefined &&
    final.isError === true &&
    final.structuredOutput === undefined &&
    ![...(final.diagnostics ?? []), ...harness].some(
      (diagnostic) => diagnostic.severity === "error",
    )
  ) {
    const text = bounded.content
      .flatMap((item) => (item.type === "text" ? [item.text] : []))
      .join("\n");
    if (text !== "") harness.push(toolDiagnostic("tool_error", text));
  }
  return {
    ...final,
    output: bounded.content,
    diagnostics: [...(final.diagnostics ?? []), ...harness],
  };
}

const structuredValidators = new WeakMap<object, ReturnType<typeof Compile>>();

function structuredOutputError(
  tool: ToolRegistration,
  result: ToolExecutionResult,
): string | undefined {
  const schema = tool.structuredOutputSchema;
  const value = result.structuredOutput;
  if (schema === undefined) {
    return value === undefined
      ? undefined
      : `Tool ${tool.name} returned structuredOutput but declares no structuredOutputSchema`;
  }
  if (value === undefined) {
    return result.isError === true ? undefined : `Tool ${tool.name} returned no structuredOutput`;
  }
  let validator = structuredValidators.get(schema);
  if (validator === undefined) {
    validator = Compile(schema);
    structuredValidators.set(schema, validator);
  }
  if (validator.Check(value)) return undefined;
  const [first] = validator.Errors(value);
  const path = first?.instancePath.replace(/^\//u, "").replace(/\//gu, ".") || "root";
  return `Tool ${tool.name} returned structuredOutput that does not match its schema: ${path}: ${first?.message ?? "invalid"}`;
}

async function settle(
  runtime: Runtime,
  input: ToolTaskInput,
  call: ToolHookCall,
  ending: Ending,
  build: (slot: Readonly<ToolSlot | NestedToolSlot> | undefined) => ToolExecutionResult,
  context: Context,
  durationMs?: number,
): Promise<void> {
  const nestedIds = (await runtime.ownedTasks(context))
    .filter(
      (record) =>
        record.kind === ToolTask.definition.name &&
        (record.input as ToolTaskInput).kind === "nested",
    )
    .map((record) => record.id);
  const madeNested = (await runtime.memo(MADE_NESTED_CALLS, context)) === true;
  await Promise.all(nestedIds.map((id) => runtime.abortOwned(id, context)));
  await runtime.commit(async (tx) => {
    const conversationId = runtime.conversationId;
    const live = await tx.doc(LiveDoc, conversationId);
    const slot = toolSlot(live, runtime.taskId);
    const result = build(slot);
    let settled: ToolTaskResult;
    if (input.kind === "nested") {
      const nested = nestedResult(runtime.taskId, result, durationMs);
      if (nested.usage !== undefined)
        await recordUsage(tx, conversationId, "tools", call.name, nested.usage);
      const state = await tx.doc(NestedCallDoc, input.parent, input.key, null);
      if (state.taskId !== runtime.taskId)
        throw new Error(`Nested call ${call.id} is not in its caller's index`);
      state.result = nested as unknown as Draft<JsonRepresentation<NestedToolExecutionResult>>;
      if (slot !== undefined && "parentTaskId" in slot) {
        finishSlot(slot);
        slot.summary = summaryOf(nested, result.output ?? []);
      }
      settled = { kind: "nested" };
    } else {
      const timing = { timestamp: runtime.now(), durationMs };
      const entry = await appendToolResult(tx, conversationId, call, result, timing);
      if (slot !== undefined && !("parentTaskId" in slot)) {
        finishSlot(slot);
        slot.entry = entry.id;
      }
      const control =
        result.control === undefined || ending.status !== "completed"
          ? {}
          : {
              control: copyJson(result.control as JsonValue, {
                omitUndefinedProperties: true,
              }) as ToolControl,
            };
      settled = { kind: "model", entryId: entry.id, ...control };
    }
    if (madeNested) removeNestedSlots(live, runtime.taskId);
    if (ending.status === "aborted")
      return { status: "terminal", outcome: { status: "aborted", result: settled } };
    if (ending.status === "failed") {
      const error = { message: ending.message };
      return { status: "terminal", outcome: { status: "failed", error, result: settled } };
    }
    return { status: "terminal", outcome: { status: "completed", result: settled } };
  }, context);
}

function nestedResult(
  taskId: TaskId,
  result: ToolExecutionResult,
  durationMs: number | undefined,
): NestedToolExecutionResult {
  const nested = {
    taskId,
    structuredOutput: result.structuredOutput,
    isError: result.isError ?? false,
    details: result.details,
    diagnostics: result.diagnostics ?? [],
    usage: result.usage,
    durationMs,
  };
  return copyJson(nested as unknown as JsonValue, {
    omitUndefinedProperties: true,
  }) as unknown as NestedToolExecutionResult;
}

async function startNestedCall(
  runtime: Runtime,
  parentCallId: string,
  name: string,
  args: JsonObject,
  options: {
    readonly key: string;
    readonly progress: boolean | undefined;
    readonly abandonOnRestart: boolean;
  },
  context: Context,
): Promise<TaskId<ToolTaskResult>> {
  const key = options.key;
  const call: ToolCall = {
    type: "toolCall",
    id: `${parentCallId}/${key}`,
    name,
    arguments: copyJson(args, { omitUndefinedProperties: true }) as JsonObject,
  };
  let id: TaskId<ToolTaskResult> | undefined;
  await runtime.commit(async (tx) => {
    const state = await tx.doc(NestedCallDoc, runtime.taskId, key, null);
    const existing = state.taskId;
    if (existing !== undefined) {
      const input = (await tx.task(existing))?.input as ToolTaskInput | undefined;
      const same =
        input?.kind === "nested" &&
        input.call.name === name &&
        jsonEqual(input.call.arguments as JsonValue, call.arguments as JsonValue);
      if (!same)
        throw new Error(
          `Nested call ${call.id} was already made with another tool or other arguments`,
        );
      id = existing as TaskId<ToolTaskResult>;
      return undefined;
    }
    const input: ToolTaskInput = {
      kind: "nested",
      parent: runtime.taskId,
      parentCallId,
      key,
      call,
      ...(options.progress === false ? { progress: false } : {}),
    };
    const created = await tx.createTask(ToolTask, input, {
      ownership: { kind: "task", taskId: runtime.taskId },
      abandonOnRestart: options.abandonOnRestart,
    });
    state.taskId = created;
    const live = await tx.doc(LiveDoc, runtime.conversationId);
    live.nestedTools ??= [];
    const slot: NestedToolSlot = {
      callId: call.id,
      parentCallId,
      parentTaskId: runtime.taskId,
      name,
      taskId: created,
      arguments: call.arguments as JsonObject,
      status: "pending",
    };
    live.nestedTools.push(slot as Draft<NestedToolSlot>);
    id = created;
    return undefined;
  }, context);
  return id!;
}

function outputValue(output: Content): string | ImageContent | Content {
  if (output.length === 0) return "";
  if (output.length > 1) return output;
  const [only] = output;
  return only!.type === "text" ? only!.text : only!;
}

function fallbackResult(
  taskId: TaskId,
  name: string,
  outcome: TaskOutcome<ToolTaskResult>,
): NestedToolExecutionResult {
  const message =
    outcome.status === "faulted"
      ? `Tool ${name} failed: ${outcome.error.message}`
      : outcome.status === "orphaned"
        ? `Tool ${name} could not resume: ${outcome.reason}`
        : `Tool ${name} ended without a result`;
  const error = harnessError(outcome.status, message);
  return { taskId, isError: true, diagnostics: error.diagnostics ?? [] };
}

type Ending =
  | { readonly status: "completed" | "aborted" }
  | { readonly status: "failed"; readonly message: string };

const COMPLETED: Ending = { status: "completed" };

function fromSlot(
  slot: Readonly<ToolSlot | NestedToolSlot> | undefined,
  code: string,
  message: string,
): ToolExecutionResult {
  const diagnostics = [...(slot?.diagnostics ?? [])];
  const droppedBytes = slot?.droppedBytes ?? 0;
  if (droppedBytes > 0)
    diagnostics.push(truncated({ droppedBytes, droppedLines: slot?.droppedLines ?? 0 }));
  diagnostics.push(toolDiagnostic(code, message));
  return {
    output:
      slot?.output === undefined || slot.output === "" ? [] : [{ type: "text", text: slot.output }],
    isError: true,
    ...(slot?.details === undefined ? {} : { details: slot.details }),
    diagnostics,
  };
}

export function harnessError(code: string, message: string): ToolExecutionResult {
  return { output: [], isError: true, diagnostics: [toolDiagnostic(code, message)] };
}

function toolDiagnostic(code: string, message: string): ToolDiagnostic {
  return { severity: "error", code, message };
}

function truncated(
  dropped: { readonly droppedLines: number; readonly droppedBytes: number },
  retain?: "head" | "tail",
): ToolDiagnostic {
  const kept = retain === undefined ? "" : ` to its ${retain === "head" ? "beginning" : "end"}`;
  return {
    severity: "warn",
    code: "truncated",
    message: `Output truncated${kept}: ${dropped.droppedLines} lines, ${dropped.droppedBytes} bytes dropped`,
  };
}

const MAX_SUMMARY_ERROR_CHARS = 500;

function summaryOf(result: NestedToolExecutionResult, output: Content): NestedToolSummary {
  const error = result.isError ? errorTextOf(result, output).slice(0, MAX_SUMMARY_ERROR_CHARS) : "";
  return {
    isError: result.isError,
    ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
    ...(result.usage === undefined
      ? {}
      : {
          usage: copyJson(result.usage, { omitUndefinedProperties: true }) as NonNullable<
            NestedToolSummary["usage"]
          >,
        }),
    ...(error === "" ? {} : { error }),
  };
}

function errorTextOf(result: NestedToolExecutionResult, output: Content): string {
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) return errors.map((diagnostic) => diagnostic.message).join("\n");
  return output.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}

export async function appendToolResult(
  tx: Tx,
  conversationId: ConversationId,
  call: ToolCall,
  result: ToolExecutionResult,
  meta: { readonly timestamp: number; readonly durationMs?: number | undefined },
): Promise<TypedEntry<{ diagnostics: ToolDiagnostic[] }>> {
  const { timestamp, durationMs } = meta;
  const diagnostics = [...(result.diagnostics ?? [])];
  const content: Content = [...(result.output ?? [])];
  if (diagnostics.length > 0) content.push({ type: "text", text: renderDiagnostics(diagnostics) });
  const message = {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content,
    ...(result.details === undefined ? {} : { details: result.details }),
    ...(result.usage === undefined ? {} : { usage: result.usage }),
    isError: result.isError ?? false,
    ...(durationMs === undefined ? {} : { durationMs }),
    timestamp,
  } as ToolResultMessage;
  if (result.usage !== undefined)
    await recordUsage(tx, conversationId, "tools", call.name, result.usage);
  return tx.appendEntry(ToolResultEntry, conversationId, {
    model: [message],
    data: { diagnostics },
  });
}

function renderDiagnostics(diagnostics: readonly ToolDiagnostic[]): string {
  return `<harness>\n${diagnostics.map((diagnostic) => `[${diagnostic.severity}] ${diagnostic.message}`).join("\n")}\n</harness>`;
}

function boundContent(
  content: Content,
  limits: OutputLimits,
): { content: Content; droppedBytes: number; droppedLines: number } {
  const texts = content.filter((item): item is TextContent => item.type === "text");
  const bounded = boundOutput(texts.map((item) => item.text).join(""), limits);
  if (bounded.droppedBytes === 0) return { content, droppedBytes: 0, droppedLines: 0 };
  const keep = limits.retain === "head" ? texts[0] : texts.at(-1);
  const result: Content = [];
  for (const item of content) {
    if (item.type !== "text") result.push(item);
    else if (item === keep) result.push({ ...item, text: bounded.text });
  }
  return {
    content: result,
    droppedBytes: bounded.droppedBytes,
    droppedLines: bounded.droppedLines,
  };
}

function checkKey(key: string): void {
  if (key === "" || key.includes("/") || key === "__proto__" || /^[1-9][0-9]*$/u.test(key)) {
    throw new Error(
      `Nested call key ${JSON.stringify(key)} must be non-empty, without "/", not "__proto__", and not a positive integer`,
    );
  }
}

function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => jsonEqual(item, b[i]!))
    );
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key]!, b[key]!))
  );
}
