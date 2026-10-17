import { type Context, copyJson, type JsonValue } from "@msa/chord";
import { toCodemodeIdentifier } from "@msa/codemode/portable";
import type { CodemodeSourceOptions } from "@msa/codemode/source";
import { Effect } from "effect";

import { currentTimeMillis } from "../clock.ts";
import type { Agent, ToolExecutionApi, ToolExecutionResult } from "../harness/types.ts";
import { namespaceOf, sampleOf } from "./describe.ts";
import { CATALOG_GLOBALS, CODEMODE_INTERNAL_PREFIX, MODEL_CALLS } from "./models.ts";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "./output.ts";
import {
  CODEMODE_MODULE_VERSION,
  CodemodeJournalDoc,
  CodemodeRunDoc,
  CodemodeStoreDoc,
  type CodemodeToolOptions,
  commitWith,
  DISCOVERY_GLOBALS,
  type JournalEntry,
  type Start,
} from "./run-docs.ts";

type Declared = Pick<Start, "tools" | "globals" | "namespaces">;

function namespacesOf(agent: Agent, options: CodemodeToolOptions): Start["namespaces"] {
  const namespaces: Start["namespaces"] = [];
  for (const tool of agent.callable) {
    if (tool.name.startsWith(CODEMODE_INTERNAL_PREFIX)) continue;
    const namespace = namespaceOf(tool.name, options.namespaces ?? []);
    if (namespace === undefined) continue;
    let entry = namespaces.find((candidate) => candidate.name === namespace.name);
    if (entry === undefined) {
      entry = {
        name: namespace.name,
        ...(namespace.description === undefined ? {} : { description: namespace.description }),
        ...(namespace.instructions === undefined ? {} : { instructions: namespace.instructions }),
        tools: [],
      };
      namespaces.push(entry);
    }
    entry.tools.push(tool.name);
  }
  return namespaces;
}

function declarationsOf(agent: Agent, options: CodemodeToolOptions): Declared {
  const tools = agent.callable.map((tool) => ({
    name: tool.name,
    jsName: toCodemodeIdentifier(tool.name),
    description: sampleOf(tool),
    ...(tool.structuredOutputSchema === undefined ? {} : { structured: true as const }),
    ...(tool.name.startsWith(CODEMODE_INTERNAL_PREFIX) ? { hidden: true as const } : {}),
  }));
  const models = options.models === false ? [] : [...CATALOG_GLOBALS, ...Object.keys(MODEL_CALLS)];
  const globals = [
    ...DISCOVERY_GLOBALS.map((name) => ({ name, spread: true })),
    ...models.map((name) => ({ name, spread: true })),
    ...(options.globals ?? []).map((global) => ({
      name: global.name,
      spread: global.spread === true,
    })),
  ];
  return { tools, namespaces: namespacesOf(agent, options), globals };
}

export type OpenedRun =
  | { readonly done: ToolExecutionResult }
  | {
      readonly start: Start;
      readonly journal: JournalEntry[];
      readonly firstIssued: number | undefined;
      readonly rerun: boolean;
    };

export const openRun = Effect.fnUntraced(function* (
  options: CodemodeToolOptions,
  sourceOptions: CodemodeSourceOptions,
  api: ToolExecutionApi,
  context: Context,
) {
  const declared = declarationsOf(yield* Effect.promise(() => api.agent(context)), options);
  const now = currentTimeMillis();
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return yield* commitWith(api, context, (tx) =>
    Effect.gen(function* () {
      const run = yield* Effect.promise(() => tx.doc(CodemodeRunDoc, api.taskId));
      if (run.result !== undefined) {
        const done: OpenedRun = {
          done: copyJson(run.result as JsonValue) as ToolExecutionResult,
        };
        return done;
      }
      const rerun = run.start !== undefined;
      if (run.start === undefined) {
        const store = yield* Effect.promise(() => tx.doc(CodemodeStoreDoc, api.conversationId));
        const timeout = sourceOptions.timeoutMs;
        run.start = {
          version: CODEMODE_MODULE_VERSION,
          startedAt: now,
          seed,
          ...(timeout === undefined ? {} : { deadline: now + timeout }),
          ...declared,
          maxOutputTokens: sourceOptions.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          store: copyJson(store.values as JsonValue) as Record<string, JsonValue>,
        };
      }
      const journal = yield* Effect.promise(() => tx.doc(CodemodeJournalDoc, api.taskId));
      const opened: OpenedRun = {
        start: copyJson(run.start as unknown as JsonValue) as unknown as Start,
        journal: copyJson(journal.entries as unknown as JsonValue) as unknown as JournalEntry[],
        firstIssued: journal.firstIssued,
        rerun,
      };
      return opened;
    }),
  );
});

export const remainingOf = (start: Start): number | undefined =>
  start.deadline === undefined ? undefined : start.deadline - currentTimeMillis();
