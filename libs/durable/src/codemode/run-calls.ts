import type { Context, JsonValue } from "@msa/chord";
import type { CodemodeHostCall, CodemodeOutcome } from "@msa/codemode/portable";
import { Cause, Effect, Exit, Semaphore } from "effect";

import { errorMessage } from "../errors.ts";
import type { ToolExecutionApi } from "../harness/types.ts";
import type { JsonObject } from "../types.ts";
import { CallRows, countImages, outcomeOf } from "./call-rows.ts";
import { discover } from "./discover.ts";
import {
  CATALOG_GLOBALS,
  CODEMODE_INTERNAL_PREFIX,
  catalogCall,
  GENERATE_IMAGES_TOOL,
  MAX_CONCURRENT_MODEL_CALLS,
} from "./models.ts";
import { type CodemodeToolOptions, DISCOVERY_GLOBALS, type Start } from "./run-docs.ts";

export type CallHost = {
  readonly options: CodemodeToolOptions;
  readonly api: ToolExecutionApi;
  readonly context: Context;
  readonly start: Start;
  readonly rows: CallRows;
  readonly modelSlots: Semaphore.Semaphore;
  readonly stopped: () => boolean;
  readonly generated: (images: number) => void;
};

export const createCallHost = (base: Omit<CallHost, "rows" | "modelSlots">): CallHost => ({
  ...base,
  rows: new CallRows(),
  modelSlots: Semaphore.makeUnsafe(MAX_CONCURRENT_MODEL_CALLS),
});

export const callTool = Effect.fnUntraced(function* (host: CallHost, call: CodemodeHostCall) {
  const { api, context, start } = host;
  const args = (call.args ?? {}) as JsonObject;
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

const globalValue = (host: CallHost, call: CodemodeHostCall) => {
  if ((DISCOVERY_GLOBALS as readonly string[]).includes(call.name))
    return Effect.sync(() => discover(host.start, call));
  if ((CATALOG_GLOBALS as readonly string[]).includes(call.name))
    return catalogCall(call.name, call.args, host.api.models, host.context);
  const global = host.options.globals?.find((candidate) => candidate.name === call.name);
  if (global === undefined) return undefined;
  return Effect.promise((): Promise<JsonValue | undefined> =>
    global.execute(call.args, host.api, host.context),
  );
};

export const callGlobal = Effect.fnUntraced(function* (host: CallHost, call: CodemodeHostCall) {
  const value = globalValue(host, call);
  if (value === undefined) {
    const unknown: CodemodeOutcome = { ok: false, message: `Unknown global ${call.name}` };
    return unknown;
  }
  const exit = yield* Effect.exit(value);
  if (Exit.isSuccess(exit)) {
    const done: CodemodeOutcome = { ok: true, value: exit.value };
    return done;
  }
  const error = Cause.squash(exit.cause);
  if (host.context.abortSignal?.aborted === true) throw error;
  const failed: CodemodeOutcome = { ok: false, message: errorMessage(error) };
  return failed;
});
