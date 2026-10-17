import type { Context, JsonValue } from "@msa/chord";
import type { CodemodeOutcome, CodemodeSandboxBase } from "@msa/codemode/portable";
import { Effect } from "effect";

import { defineDoc } from "../documents.ts";
import type { ToolExecutionApi, ToolExecutionResult } from "../harness/types.ts";
import type { JsonObject, Tx } from "../types.ts";
import type { CodemodeNamespace } from "./describe.ts";

export const CODEMODE_MODULE_VERSION = 2;

export const DISCOVERY_GLOBALS = ["searchTools", "describeTool", "describeNamespace"] as const;

export const OUTPUT_LIMITS = { maxBytes: 4 * 1024 * 1024, maxLines: 100_000 } as const;

export type CodemodeGlobal = {
  readonly name: string;
  readonly spread?: boolean;
  execute(args: unknown, api: ToolExecutionApi, context: Context): Promise<JsonValue | undefined>;
};

export type CodemodeToolOptions = {
  readonly sandbox: CodemodeSandboxBase;
  readonly namespaces?: readonly CodemodeNamespace[];
  readonly inlineBudget?: number;
  readonly models?: boolean;
  readonly globals?: readonly CodemodeGlobal[];
};

export type DeclaredTool = {
  name: string;
  jsName: string;
  description: string;
  structured?: true;
  hidden?: true;
};

export type Start = {
  version: number;
  startedAt: number;
  seed: number;
  fingerprint?: string;
  deadline?: number;
  tools: DeclaredTool[];
  namespaces: { name: string; description?: string; instructions?: string; tools: string[] }[];
  globals: { name: string; spread: boolean }[];
  maxOutputTokens: number;
  store: Record<string, JsonValue>;
};

type RunState = {
  start?: Start;
  outputDir?: string;
  result?: JsonObject;
};

export const CodemodeRunDoc = defineDoc<RunState>({
  kind: "msa.codemode.run",
  version: 1,
  scope: "task",
  initial: () => ({}),
});

export type JournalEntry = {
  id: number;
  at: number;
  issuedAfter?: number;
  global?: { name: string; args?: JsonValue; outcome: JsonObject };
};

type JournalState = {
  entries: JournalEntry[];
  firstIssued?: number;
};

export const CodemodeJournalDoc = defineDoc<JournalState>({
  kind: "msa.codemode.journal",
  version: 1,
  scope: "task",
  initial: () => ({ entries: [] }),
});

export const CodemodeStoreDoc = defineDoc<{ values: Record<string, JsonValue> }>({
  kind: "msa.codemode.store",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ values: {} }),
});

export type Settled = {
  readonly id: number;
  readonly at: number;
  readonly outcome: CodemodeOutcome;
  readonly global?: JournalEntry["global"];
};

export const commitWith = Effect.fnUntraced(function* <T>(
  api: ToolExecutionApi,
  context: Context,
  change: (tx: Tx) => Effect.Effect<T>,
) {
  const run = Effect.runPromiseWith(yield* Effect.context());
  return yield* Effect.promise(() => api.commit((tx) => run(change(tx)), context));
});

export const errorResult = (message: string): ToolExecutionResult => ({
  output: [{ type: "text", text: message }],
  isError: true,
});
