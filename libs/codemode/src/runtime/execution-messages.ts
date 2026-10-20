import * as Effect from "effect/Effect";

import type typesModule from "../types.ts";
import bridge from "./bridge.ts";
import executionModule from "./execution.ts";
import preludeSource from "./prelude-source.ts";
import type protocolTypes from "./protocol.ts";

const { RuntimeError, parseBridgeJson, parseScriptError, parseStoreWrites } = bridge;
const { errorMessage, parseJson, stringifyJson } = preludeSource;
const toolError = (error: unknown) =>
  new RuntimeError({ message: errorMessage(error), reason: "tool" });

const invokeTool = (
  executors: protocolTypes.Executors,
  message: protocolTypes.CallMessage,
  signal: AbortSignal,
) => {
  const isTool = message.target === "tool";
  const tool = (isTool ? executors.tools : executors.globals).get(message.name);
  if (tool === undefined)
    return Effect.fail(toolError(`Unknown ${isTool ? "tool" : "global"} "${message.name}"`));
  return Effect.tryPromise({
    catch: toolError,
    try: () => {
      const args = message.args === undefined ? undefined : parseJson(message.args);
      return Promise.resolve(tool.execute(args, { signal }));
    },
  }).pipe(
    Effect.flatMap((value) => Effect.try({ catch: toolError, try: () => stringifyJson(value) })),
  );
};

const track = (
  execution: protocolTypes.Execution,
  message: protocolTypes.CallMessage,
): protocolTypes.PendingCall => {
  const record: typesModule.CodemodeCall | undefined =
    message.target === "tool"
      ? { durationMs: 0, name: message.name, status: "cancelled" }
      : undefined;
  if (record !== undefined) execution.calls.push(record);
  const pending = { controller: new AbortController(), record, startedAt: performance.now() };
  execution.pending.set(message.id, pending);
  return pending;
};

const reply = (
  execution: protocolTypes.Execution,
  id: number,
  pending: protocolTypes.PendingCall,
  ok: boolean,
  payload: string | undefined,
): void => {
  if (!execution.pending.delete(id)) return;
  executionModule.complete(pending, ok);
  executionModule.post(execution, { id, ok, payload, type: "result" });
};

const handleCall = (
  execution: protocolTypes.Execution,
  message: protocolTypes.CallMessage,
): void => {
  const pending = track(execution, message);
  Effect.runFork(
    invokeTool(execution.options.executors, message, pending.controller.signal).pipe(
      Effect.match({
        onFailure: (error) => reply(execution, message.id, pending, false, error.message),
        onSuccess: (payload) => reply(execution, message.id, pending, true, payload),
      }),
    ),
  );
};

const handleDone = (
  execution: protocolTypes.Execution,
  message: protocolTypes.DoneMessage,
): void => {
  if (!message.ok) {
    executionModule.finish(
      execution,
      parseScriptError(message.error),
      undefined,
      undefined,
      message.during,
    );
    return;
  }
  const value =
    message.value === undefined ? undefined : parseBridgeJson(message.value, "return value");
  executionModule.finish(
    execution,
    undefined,
    value,
    parseStoreWrites(message.writes),
    message.during,
  );
};

const bridgeError = (message: string) => new RuntimeError({ message, reason: "bridge" });

const handleCallMessage = (
  execution: protocolTypes.Execution,
  message: protocolTypes.CallMessage,
): void => {
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
  control.onCall({ args, id, name, target });
};

const handleMessage = (execution: protocolTypes.Execution, message: unknown): void => {
  if (execution.finished) return;
  if (!executionModule.isWorkerToHostMessage(message))
    throw bridgeError("unknown message from the worker");
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
      executionModule.finish(execution, { kind: "sandbox", message: message.message });
      break;
  }
};

const executionMessages = {
  handleCall,
  handleCallMessage,
  handleDone,
  handleMessage,
};

export default executionMessages;
