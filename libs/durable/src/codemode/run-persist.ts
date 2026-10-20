import chord from "@msa/chord";
import type chordTypes from "@msa/chord/index.types";
import type { CodemodeResult } from "@msa/codemode/portable";
import { Effect } from "effect";

import type typesModule from "../harness/types.types.ts";
import outputModule from "./output.ts";
import runDocs from "./run-docs.ts";
import type runDocsTypes from "./run-docs.types.ts";
import runPersistKit from "./run-persist-kit.ts";
import type runPersistTypes from "./run-persist.types.ts";

const { clock: clockModule, outputFiles: outputFilesModule } = runPersistKit;

const { copyJson } = chord;

const { CodemodeJournalDoc, CodemodeRunDoc, CodemodeStoreDoc, OUTPUT_LIMITS, commitWith } = runDocs;
const { formatResult } = outputModule;
const { currentTimeMillis } = clockModule;
const { outputFiles } = outputFilesModule;

const decideRun = Effect.fnUntraced(function* (
  api: typesModule.ToolExecutionApi,
  context: chordTypes.Context,
  decided: typesModule.ToolExecutionResult,
  details: runPersistTypes.CodemodeToolDetails,
) {
  const result = { ...decided, details: details as unknown as chordTypes.JsonValue };
  yield* commitWith(api, context, (tx) =>
    Effect.map(
      Effect.promise(() => tx.doc(CodemodeRunDoc, api.taskId)),
      (run) => {
        run.result ??= copyJson(result as unknown as chordTypes.JsonValue, {
          omitUndefinedProperties: true,
        }) as runPersistTypes.JsonObject;
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

const completeRun = Effect.fnUntraced(function* (
  api: typesModule.ToolExecutionApi,
  context: chordTypes.Context,
  start: runDocsTypes.Start,
  outcome: { readonly result: CodemodeResult; readonly generatedImages: number },
  details: runPersistTypes.CodemodeToolDetails,
) {
  const { result } = outcome;
  const formatted = yield* formatResult(result, {
    calls: details.calls,
    generatedImages: outcome.generatedImages,
    limits: OUTPUT_LIMITS,
    maxOutputTokens: start.maxOutputTokens,
    wallMs: currentTimeMillis() - start.startedAt,
    write: outputFiles(api, context),
  });
  const tool: typesModule.ToolExecutionResult = {
    details: {
      ...details,
      ...(formatted.fullOutputPath === undefined
        ? {}
        : { fullOutputPath: formatted.fullOutputPath }),
    } as unknown as chordTypes.JsonValue,
    isError: !result.ok,
    output: formatted.content,
  };
  const writes = storeWrites(result);
  return yield* commitWith(api, context, (tx) =>
    Effect.gen(function* () {
      const run = yield* Effect.promise(() => tx.doc(CodemodeRunDoc, api.taskId));
      if (run.result !== undefined) return run.result as typesModule.ToolExecutionResult;
      run.result = copyJson(tool as unknown as chordTypes.JsonValue, {
        omitUndefinedProperties: true,
      }) as runPersistTypes.JsonObject;
      if (writes !== undefined) {
        const store = yield* Effect.promise(() => tx.doc(CodemodeStoreDoc, api.conversationId));
        for (const key of writes.delete) delete store.values[key];
        for (const [key, value] of Object.entries(writes.set))
          store.values[key] = value as chordTypes.JsonValue;
      }
      return tool;
    }),
  );
});

const appendJournal = Effect.fnUntraced(function* (
  api: typesModule.ToolExecutionApi,
  context: chordTypes.Context,
  acks: readonly (readonly [number, number])[],
  batch: readonly runDocsTypes.Settled[],
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
            at: item.at,
            id: item.id,
            ...(item.global === undefined ? {} : { global: item.global }),
          };
          journal.entries.push(
            copyJson(entry as unknown as chordTypes.JsonValue, {
              omitUndefinedProperties: true,
            }) as unknown as runDocsTypes.JournalEntry,
          );
        }
      },
    ),
  );
});

const recordFingerprint = Effect.fnUntraced(function* (
  host: { readonly api: typesModule.ToolExecutionApi; readonly context: chordTypes.Context },
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

const runPersist = {
  appendJournal,
  completeRun,
  decideRun,
  recordFingerprint,
};

export default runPersist;
