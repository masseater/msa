import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { dual } from "effect/Function";

import type {
  CodemodeCall,
  CodemodeDuring,
  CodemodeError,
  CodemodeResult,
  CodemodeStoreWrites,
} from "../types.ts";
import {
  parseBridgeJson,
  parseScriptError,
  parseStoreWrites,
  RuntimeError,
  toCodemodeIdentifier,
} from "./bridge.ts";
import { causeMessage, errorMessage, parseJson, stringifyJson } from "./prelude-source.ts";
import type {
  CallMessage,
  DoneMessage,
  Execution,
  ExecutionOptions,
  Executors,
  HostToWorkerMessage,
  PendingCall,
  VmChannel,
  VmStartData,
  WorkerToHostMessage,
} from "./protocol.ts";

export function isWorkerToHostMessage(value: unknown): value is WorkerToHostMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "call" ||
    type === "output" ||
    type === "done" ||
    type === "crash" ||
    type === "started" ||
    type === "idle"
  );
}

const startData = (options: ExecutionOptions): VmStartData => ({
  code: options.code,
  tools: options.tools.map((tool) => ({
    name: tool.name,
    jsName: tool.jsName ?? toCodemodeIdentifier(tool.name),
    description: tool.description ?? "",
  })),
  globals: options.globals.map((global) => ({ name: global.name, spread: global.spread === true })),
  memoryLimitBytes: options.memoryLimitBytes,
  store: options.store,
  ...(Number.isFinite(options.timeoutMs) ? { timeoutMs: options.timeoutMs } : {}),
  ...(options.deterministic === undefined ? {} : { deterministic: options.deterministic }),
});

const toolError = (error: unknown) =>
  new RuntimeError({ reason: "tool", message: errorMessage(error) });

const invokeTool = (executors: Executors, message: CallMessage, signal: AbortSignal) => {
  const isTool = message.target === "tool";
  const tool = (isTool ? executors.tools : executors.globals).get(message.name);
  if (tool === undefined)
    return Effect.fail(toolError(`Unknown ${isTool ? "tool" : "global"} "${message.name}"`));
  return Effect.tryPromise({
    try: () => {
      const args = message.args === undefined ? undefined : parseJson(message.args);
      return Promise.resolve(tool.execute(args, { signal }));
    },
    catch: toolError,
  }).pipe(
    Effect.flatMap((value) => Effect.try({ try: () => stringifyJson(value), catch: toolError })),
  );
};

export const post: {
  (message: HostToWorkerMessage): (execution: Execution) => void;
  (execution: Execution, message: HostToWorkerMessage): void;
} = dual(2, (execution: Execution, message: HostToWorkerMessage): void => {
  if (execution.channel === undefined) execution.unsent.push(message);
  else execution.channel.post(message);
});

const settle = (execution: Execution, result: CodemodeResult): void => {
  const { channel } = execution;
  if (channel === undefined) {
    Deferred.doneUnsafe(execution.result, Exit.succeed(result));
    return;
  }
  Effect.runFork(channel.stop.pipe(Effect.andThen(Deferred.succeed(execution.result, result))));
};

function finish(
  execution: Execution,
  error: CodemodeError | undefined,
  value?: unknown,
  writes?: CodemodeStoreWrites,
  during?: CodemodeDuring,
): void {
  if (execution.finished) return;
  execution.finished = true;
  execution.timer?.interruptUnsafe();
  execution.options.signal?.removeEventListener("abort", execution.onAbort);
  const now = performance.now();
  for (const pending of execution.pending.values()) {
    if (pending.record !== undefined) pending.record.durationMs = now - pending.startedAt;
    pending.controller.abort();
  }
  execution.pending.clear();
  execution.unsent = [];
  const ended = during === undefined ? {} : { during: { seq: during.seq, issued: during.issued } };
  const { output, calls } = execution;
  settle(
    execution,
    error === undefined
      ? { ok: true, value, output, calls, storeWrites: writes ?? { set: {}, delete: [] }, ...ended }
      : { ok: false, error, output, calls, ...ended },
  );
}

const track = (execution: Execution, message: CallMessage): PendingCall => {
  const record: CodemodeCall | undefined =
    message.target === "tool"
      ? { name: message.name, status: "cancelled", durationMs: 0 }
      : undefined;
  if (record !== undefined) execution.calls.push(record);
  const pending = { record, startedAt: performance.now(), controller: new AbortController() };
  execution.pending.set(message.id, pending);
  return pending;
};

export const complete: {
  (ok: boolean): (pending: PendingCall) => void;
  (pending: PendingCall, ok: boolean): void;
} = dual(2, (pending: PendingCall, ok: boolean): void => {
  if (pending.record === undefined) return;
  pending.record.status = ok ? "ok" : "error";
  pending.record.durationMs = performance.now() - pending.startedAt;
});

export const abort: {
  (message: string): (execution: Execution) => Promise<CodemodeResult>;
  (execution: Execution, message: string): Promise<CodemodeResult>;
} = dual(2, (execution: Execution, message: string): Promise<CodemodeResult> => {
  finish(execution, { kind: "aborted", message });
  return execution.promise;
});

const reply = (
  execution: Execution,
  id: number,
  pending: PendingCall,
  ok: boolean,
  payload: string | undefined,
): void => {
  if (!execution.pending.delete(id)) return;
  complete(pending, ok);
  post(execution, { type: "result", id, ok, payload });
};

const handleCall = (execution: Execution, message: CallMessage): void => {
  const pending = track(execution, message);
  Effect.runFork(
    invokeTool(execution.options.executors, message, pending.controller.signal).pipe(
      Effect.match({
        onSuccess: (payload) => reply(execution, message.id, pending, true, payload),
        onFailure: (error) => reply(execution, message.id, pending, false, error.message),
      }),
    ),
  );
};

const handleDone = (execution: Execution, message: DoneMessage): void => {
  if (!message.ok) {
    finish(execution, parseScriptError(message.error), undefined, undefined, message.during);
    return;
  }
  const value =
    message.value === undefined ? undefined : parseBridgeJson(message.value, "return value");
  finish(execution, undefined, value, parseStoreWrites(message.writes), message.during);
};

const bridgeError = (message: string) => new RuntimeError({ reason: "bridge", message });

const handleCallMessage = (execution: Execution, message: CallMessage): void => {
  if (execution.pending.has(message.id)) throw bridgeError(`duplicate call id ${message.id}`);
  const { control } = execution.options;
  if (control === undefined) {
    handleCall(execution, message);
    return;
  }
  const { id, name, target } = message;
  const args =
    message.args === undefined ? undefined : parseBridgeJson(message.args, "call arguments");
  track(execution, message);
  control.onCall({ id, target, name, args });
};

const handleMessage = (execution: Execution, message: unknown): void => {
  if (execution.finished) return;
  if (!isWorkerToHostMessage(message)) throw bridgeError("unknown message from the worker");
  const { control } = execution.options;
  switch (message.type) {
    case "output":
      execution.output.push(message.item);
      break;
    case "call":
      handleCallMessage(execution, message);
      break;
    case "started":
      control?.onStarted?.(message.fingerprint);
      break;
    case "idle":
      control?.onIdle?.(message.seq, message.issued);
      break;
    case "done":
      handleDone(execution, message);
      break;
    case "crash":
      finish(execution, { kind: "sandbox", message: message.message });
      break;
  }
};

const receive = (execution: Execution, message: unknown): void => {
  try {
    handleMessage(execution, message);
  } catch (error) {
    finish(execution, {
      kind: "sandbox",
      message:
        error instanceof RuntimeError && error.reason === "bridge"
          ? `Sandbox bridge broken: ${error.message}. The script may have modified built-ins such as a prototype's toJSON.`
          : `Sandbox host failed: ${errorMessage(error)}`,
    });
  }
};

const attach = (execution: Execution, channel: VmChannel): Effect.Effect<void> => {
  if (execution.finished) return channel.stop;
  return Effect.sync(() => {
    execution.channel = channel;
    for (const message of execution.unsent.splice(0)) channel.post(message);
  });
};

const launch = (execution: Execution): void => {
  const { options } = execution;
  const events = {
    message: (message: unknown) => receive(execution, message),
    failure: (error: CodemodeError) => finish(execution, error),
  };
  Effect.runFork(
    options.launch(startData(options), events).pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        Exit.isSuccess(exit)
          ? attach(execution, exit.value)
          : Effect.sync(() =>
              finish(execution, { kind: "sandbox", message: causeMessage(exit.cause) }),
            ),
      ),
    ),
  );
};

export function startExecution(options: ExecutionOptions): Execution {
  const result = Deferred.makeUnsafe<CodemodeResult>();
  const execution: Execution = {
    options,
    result,
    promise: Effect.runPromise(result.pipe(Deferred.await)),
    delivered: new Set(),
    output: [],
    calls: [],
    pending: new Map(),
    onAbort: () => {
      const reason: unknown = options.signal?.reason;
      const message = reason instanceof Error ? reason.message : "Execution aborted";
      finish(execution, { kind: "aborted", message });
    },
    channel: undefined,
    unsent: [],
    timer: undefined,
    finished: false,
  };
  if (Number.isFinite(options.timeoutMs)) {
    const message = `Execution timed out after ${options.timeoutMs} ms`;
    const timedOut = Effect.sync(() => finish(execution, { kind: "timeout", message }));
    execution.timer = Effect.runFork(Effect.delay(timedOut, options.timeoutMs));
  }
  if (options.signal?.aborted === true) execution.onAbort();
  else options.signal?.addEventListener("abort", execution.onAbort, { once: true });
  if (!execution.finished) launch(execution);
  return execution;
}
