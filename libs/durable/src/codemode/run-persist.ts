import { type Context, copyJson, type JsonValue } from "@msa/chord";
import type { CodemodeResult } from "@msa/codemode/portable";
import { Effect } from "effect";

import { currentTimeMillis } from "../clock.ts";
import type { ToolExecutionApi, ToolExecutionResult } from "../harness/types.ts";
import type { JsonObject } from "../types.ts";
import type { CodemodeToolDetails } from "./call-rows.ts";
import { outputFiles } from "./output-files.ts";
import { formatResult } from "./output.ts";
import {
  CodemodeJournalDoc,
  CodemodeRunDoc,
  CodemodeStoreDoc,
  commitWith,
  type JournalEntry,
  OUTPUT_LIMITS,
  type Settled,
  type Start,
} from "./run-docs.ts";

export const decideRun = Effect.fnUntraced(function* (
  api: ToolExecutionApi,
  context: Context,
  decided: ToolExecutionResult,
  details: CodemodeToolDetails,
) {
  const result = { ...decided, details: details as unknown as JsonValue };
  yield* commitWith(api, context, (tx) =>
    Effect.map(
      Effect.promise(() => tx.doc(CodemodeRunDoc, api.taskId)),
      (run) => {
        run.result ??= copyJson(result as unknown as JsonValue, {
          omitUndefinedProperties: true,
        }) as JsonObject;
      },
    ),
  );
  return result;
});

const storeWrites = (result: CodemodeResult) => {
  const writes = result.ok ? result.storeWrites : undefined;
  return writes !== undefined && (Object.keys(writes.set).length > 0 || writes.delete.length > 0)
    ? writes
    : undefined;
};

export const completeRun = Effect.fnUntraced(function* (
  api: ToolExecutionApi,
  context: Context,
  start: Start,
  outcome: { readonly result: CodemodeResult; readonly generatedImages: number },
  details: CodemodeToolDetails,
) {
  const { result } = outcome;
  const formatted = yield* formatResult(result, {
    generatedImages: outcome.generatedImages,
    wallMs: currentTimeMillis() - start.startedAt,
    maxOutputTokens: start.maxOutputTokens,
    calls: details.calls,
    limits: OUTPUT_LIMITS,
    write: outputFiles(api, context),
  });
  const tool: ToolExecutionResult = {
    output: formatted.content,
    isError: !result.ok,
    details: {
      ...details,
      ...(formatted.fullOutputPath === undefined
        ? {}
        : { fullOutputPath: formatted.fullOutputPath }),
    } as unknown as JsonValue,
  };
  const writes = storeWrites(result);
  return yield* commitWith(api, context, (tx) =>
    Effect.gen(function* () {
      const run = yield* Effect.promise(() => tx.doc(CodemodeRunDoc, api.taskId));
      if (run.result !== undefined) return run.result as ToolExecutionResult;
      run.result = copyJson(tool as unknown as JsonValue, {
        omitUndefinedProperties: true,
      }) as JsonObject;
      if (writes !== undefined) {
        const store = yield* Effect.promise(() => tx.doc(CodemodeStoreDoc, api.conversationId));
        for (const key of writes.delete) delete store.values[key];
        for (const [key, value] of Object.entries(writes.set))
          store.values[key] = value as JsonValue;
      }
      return tool;
    }),
  );
});

export const appendJournal = Effect.fnUntraced(function* (
  api: ToolExecutionApi,
  context: Context,
  acks: readonly (readonly [number, number])[],
  batch: readonly Settled[],
) {
  yield* commitWith(api, context, (tx) =>
    Effect.map(
      Effect.promise(() => tx.doc(CodemodeJournalDoc, api.taskId)),
      (journal) => {
        for (const [seq, issued] of acks) {
          if (seq === 0) journal.firstIssued ??= issued;
          else {
            const entry = journal.entries[seq - 1];
            if (entry !== undefined && entry.issuedAfter === undefined) entry.issuedAfter = issued;
          }
        }
        for (const item of batch) {
          const entry = {
            id: item.id,
            at: item.at,
            ...(item.global === undefined ? {} : { global: item.global }),
          };
          journal.entries.push(
            copyJson(entry as unknown as JsonValue, {
              omitUndefinedProperties: true,
            }) as unknown as JournalEntry,
          );
        }
      },
    ),
  );
});

export const recordFingerprint = Effect.fnUntraced(function* (
  host: { readonly api: ToolExecutionApi; readonly context: Context },
  fingerprint: string,
) {
  const { api, context } = host;
  yield* commitWith(api, context, (tx) =>
    Effect.map(
      Effect.promise(() => tx.doc(CodemodeRunDoc, api.taskId)),
      (run) => {
        if (run.start !== undefined) run.start.fingerprint = fingerprint;
      },
    ),
  );
});
