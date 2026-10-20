import type chordTypes from "@msa/chord/index.types";
import type { CodemodeHostCall, CodemodeOutcome } from "@msa/codemode/portable";
import { Cause, Effect, Exit, Semaphore } from "effect";

import errors from "../errors.ts";
import type typesModuleModule from "../types.types.ts";
import callRows from "./call-outcome.ts";
import discoverModule from "./discover.ts";
import modelsModule from "./models.ts";
import type runCallsTypes from "./run-calls.types.ts";
import runDocs from "./run-docs.ts";

const {
  CATALOG_GLOBALS,
  CODEMODE_INTERNAL_PREFIX,
  GENERATE_IMAGES_TOOL,
  MAX_CONCURRENT_MODEL_CALLS,
  catalogCall,
} = modelsModule;
const { CallRows, countImages, outcomeOf } = callRows;
const { DISCOVERY_GLOBALS } = runDocs;
const { discover } = discoverModule;
const { errorMessage } = errors;

const createCallHost = (
  base: Omit<runCallsTypes.CallHost, "rows" | "modelSlots">,
): runCallsTypes.CallHost => ({
  ...base,
  modelSlots: Semaphore.makeUnsafe(MAX_CONCURRENT_MODEL_CALLS),
  rows: new CallRows(),
});

const callTool = Effect.fnUntraced(function* (
  host: runCallsTypes.CallHost,
  call: CodemodeHostCall,
) {
  const { api, context, start } = host;
  const args = (call.args ?? {}) as typesModuleModule.JsonObject;
  const execute = Effect.promise(() =>
    api.executeTool(call.name, args, context, { key: `c${call.id}` }),
  );
  const result = call.name.startsWith(CODEMODE_INTERNAL_PREFIX)
    ? yield* host.modelSlots.withPermits(1)(
        Effect.suspend(() => {
          if (host.stopped()) throw new Error("The script has ended");
          return execute;
        }),
      )
    : yield* execute;
  if (call.name === GENERATE_IMAGES_TOOL) host.generated(countImages(result.structuredOutput));
  const structured = start.tools.find((tool) => tool.name === call.name)?.structured === true;
  const outcome = outcomeOf(call.name, structured, result);
  host.rows.finished(call.id, outcome, result);
  return outcome;
});

const globalValue = (host: runCallsTypes.CallHost, call: CodemodeHostCall) => {
  if ((DISCOVERY_GLOBALS as readonly string[]).includes(call.name))
    return Effect.sync(() => discover(host.start, call));
  if ((CATALOG_GLOBALS as readonly string[]).includes(call.name))
    return catalogCall(call.name, call.args, host.api.models, host.context);
  const global = host.options.globals?.find((candidate) => candidate.name === call.name);
  if (global === undefined) return undefined;
  return Effect.promise((): Promise<chordTypes.JsonValue | undefined> =>
    global.execute(call.args, host.api, host.context),
  );
};

const callGlobal = Effect.fnUntraced(function* (
  host: runCallsTypes.CallHost,
  call: CodemodeHostCall,
) {
  const value = globalValue(host, call);
  if (value === undefined) {
    const unknown: CodemodeOutcome = { message: `Unknown global ${call.name}`, ok: false };
    return unknown;
  }
  const exit = yield* Effect.exit(value);
  if (Exit.isSuccess(exit)) {
    const done: CodemodeOutcome = { ok: true, value: exit.value };
    return done;
  }
  const error = Cause.squash(exit.cause);
  if (host.context.abortSignal?.aborted === true) throw error;
  const failed: CodemodeOutcome = { message: errorMessage(error), ok: false };
  return failed;
});

const runCalls = {
  callGlobal,
  callTool,
  createCallHost,
};

export default runCalls;
