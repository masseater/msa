import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { dual } from "effect/Function";
import * as Schema from "effect/Schema";

import type typesModule from "../types.ts";
import bridge from "./bridge.ts";
import executionMessages from "./execution-messages.ts";
import preludeSource from "./prelude-source.ts";
import type protocolTypes from "./protocol.ts";
const { RuntimeError, toCodemodeIdentifier } = bridge;
const { causeMessage, errorMessage } = preludeSource;

function isWorkerToHostMessage(value: unknown): value is protocolTypes.WorkerToHostMessage {
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

const startData = (options: protocolTypes.ExecutionOptions): protocolTypes.VmStartData => ({
  code: options.code,
  globals: options.globals.map((global) => ({ name: global.name, spread: global.spread === true })),
  memoryLimitBytes: options.memoryLimitBytes,
  store: options.store,
  tools: options.tools.map((tool) => ({
    description: tool.description ?? "",
    jsName: tool.jsName ?? toCodemodeIdentifier(tool.name),
    name: tool.name,
  })),
  ...(Number.isFinite(options.timeoutMs) ? { timeoutMs: options.timeoutMs } : {}),
  ...(options.deterministic === undefined ? {} : { deterministic: options.deterministic }),
});

const post: {
  (message: protocolTypes.HostToWorkerMessage): (execution: protocolTypes.Execution) => void;
  (execution: protocolTypes.Execution, message: protocolTypes.HostToWorkerMessage): void;
} = dual(
  2,
  (execution: protocolTypes.Execution, message: protocolTypes.HostToWorkerMessage): void => {
    if (execution.channel === undefined) execution.unsent.push(message);
    else execution.channel.post(message);
  },
);

const settle = (execution: protocolTypes.Execution, result: typesModule.CodemodeResult): void => {
  const { channel } = execution;
  if (channel === undefined) {
    Deferred.doneUnsafe(execution.result, Exit.succeed(result));
    return;
  }
  Effect.runFork(channel.stop.pipe(Effect.andThen(Deferred.succeed(execution.result, result))));
};

function finish(
  execution: protocolTypes.Execution,
  error: typesModule.CodemodeError | undefined,
  value?: unknown,
  writes?: typesModule.CodemodeStoreWrites,
  during?: typesModule.CodemodeDuring,
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
  const ended = during === undefined ? {} : { during: { issued: during.issued, seq: during.seq } };
  const { output, calls } = execution;
  settle(
    execution,
    error === undefined
      ? { calls, ok: true, output, storeWrites: writes ?? { delete: [], set: {} }, value, ...ended }
      : { calls, error, ok: false, output, ...ended },
  );
}

const complete: {
  (ok: boolean): (pending: protocolTypes.PendingCall) => void;
  (pending: protocolTypes.PendingCall, ok: boolean): void;
} = dual(2, (pending: protocolTypes.PendingCall, ok: boolean): void => {
  if (pending.record === undefined) return;
  pending.record.status = ok ? "ok" : "error";
  pending.record.durationMs = performance.now() - pending.startedAt;
});

const abort: {
  (message: string): (execution: protocolTypes.Execution) => Promise<typesModule.CodemodeResult>;
  (execution: protocolTypes.Execution, message: string): Promise<typesModule.CodemodeResult>;
} = dual(
  2,
  (execution: protocolTypes.Execution, message: string): Promise<typesModule.CodemodeResult> => {
    finish(execution, { kind: "aborted", message });
    return execution.promise;
  },
);

const receive = (execution: protocolTypes.Execution, message: unknown): void => {
  try {
    executionMessages.handleMessage(execution, message);
  } catch (error) {
    finish(execution, {
      kind: "sandbox",
      message:
        Schema.is(RuntimeError)(error) && error.reason === "bridge"
          ? `Sandbox bridge broken: ${error.message}. The script may have modified built-ins such as a prototype's toJSON.`
          : `Sandbox host failed: ${errorMessage(error)}`,
    });
  }
};

const attach = (
  execution: protocolTypes.Execution,
  channel: protocolTypes.VmChannel,
): Effect.Effect<void> => {
  if (execution.finished) return channel.stop;
  return Effect.sync(() => {
    execution.channel = channel;
    for (const message of execution.unsent.splice(0)) channel.post(message);
  });
};

const launch = (execution: protocolTypes.Execution): void => {
  const { options } = execution;
  const events = {
    failure: (error: typesModule.CodemodeError) => finish(execution, error),
    message: (message: unknown) => receive(execution, message),
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

function startExecution(options: protocolTypes.ExecutionOptions): protocolTypes.Execution {
  const result = Deferred.makeUnsafe<typesModule.CodemodeResult>();
  const execution: protocolTypes.Execution = {
    calls: [],
    channel: undefined,
    delivered: new Set(),
    finished: false,
    onAbort: () => {
      const reason: unknown = options.signal?.reason;
      const message = reason instanceof Error ? reason.message : "Execution aborted";
      finish(execution, { kind: "aborted", message });
    },
    options,
    output: [],
    pending: new Map(),
    promise: Effect.runPromise(result.pipe(Deferred.await)),
    result,
    timer: undefined,
    unsent: [],
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

const executionModule = {
  abort,
  complete,
  finish,
  isWorkerToHostMessage,
  post,
  startExecution,
};

export default executionModule;
