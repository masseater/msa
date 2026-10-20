import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import documents from "../documents.ts";
import type typesModule from "../harness/types.types.ts";
import type typesModuleModule from "../types.types.ts";
import type runDocsTypes from "./run-docs.types.ts";

const { defineDoc } = documents;

const CODEMODE_MODULE_VERSION = 2;

const DISCOVERY_GLOBALS = ["searchTools", "describeTool", "describeNamespace"] as const;

const OUTPUT_LIMITS = { maxBytes: 4 * 1024 * 1024, maxLines: 100_000 } as const;

type RunState = {
  start?: runDocsTypes.Start;
  outputDir?: string;
  result?: typesModuleModule.JsonObject;
};

const CodemodeRunDoc = defineDoc<RunState>({
  initial: () => ({}),
  kind: "msa.codemode.run",
  scope: "task",
  version: 1,
});

type JournalState = {
  entries: runDocsTypes.JournalEntry[];
  firstIssued?: number;
};

const CodemodeJournalDoc = defineDoc<JournalState>({
  initial: () => ({ entries: [] }),
  kind: "msa.codemode.journal",
  scope: "task",
  version: 1,
});

const CodemodeStoreDoc = defineDoc<{ values: Record<string, chordTypes.JsonValue> }>({
  fork: "asOf",
  history: "rewindable",
  initial: () => ({ values: {} }),
  kind: "msa.codemode.store",
  scope: "conversation",
  version: 1,
});

const commitWith = Effect.fnUntraced(function* <T>(
  api: typesModule.ToolExecutionApi,
  context: chordTypes.Context,
  change: (tx: typesModuleModule.Tx) => Effect.Effect<T>,
) {
  const run = Effect.runPromiseWith(yield* Effect.context());
  return yield* Effect.promise(() => api.commit((tx) => run(change(tx)), context));
});

const errorResult = (message: string): typesModule.ToolExecutionResult => ({
  isError: true,
  output: [{ text: message, type: "text" }],
});

const runDocs = {
  CODEMODE_MODULE_VERSION,
  CodemodeJournalDoc,
  CodemodeRunDoc,
  CodemodeStoreDoc,
  DISCOVERY_GLOBALS,
  OUTPUT_LIMITS,
  commitWith,
  errorResult,
};

export default runDocs;
