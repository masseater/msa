import chord from "@msa/chord";
import type chordTypes from "@msa/chord/index.types";
import portable from "@msa/codemode/portable";
import type sourceTypes from "@msa/codemode/source.types";
import { Effect } from "effect";

import type typesModule from "../harness/types.types.ts";
import type runDocsTypes from "./run-docs.types.ts";
import runStartKit from "./run-start-kit.ts";
import type runStartTypes from "./run-start.types.ts";
import startKit from "./start-kit.ts";

const { toCodemodeIdentifier } = portable;

const { clock: clockModule, runDocs } = runStartKit;

const { copyJson } = chord;

const { describe, models: modelsModule, output: outputModule } = startKit;

const { CATALOG_GLOBALS, CODEMODE_INTERNAL_PREFIX, MODEL_CALLS } = modelsModule;
const { namespaceOf, sampleOf } = describe;
const {
  CODEMODE_MODULE_VERSION,
  CodemodeJournalDoc,
  CodemodeRunDoc,
  CodemodeStoreDoc,
  DISCOVERY_GLOBALS,
  commitWith,
} = runDocs;
const { currentTimeMillis } = clockModule;
const { DEFAULT_MAX_OUTPUT_TOKENS } = outputModule;

type Declared = Pick<runDocsTypes.Start, "tools" | "globals" | "namespaces">;

function namespacesOf(
  agent: typesModule.Agent,
  options: runDocsTypes.CodemodeToolOptions,
): runDocsTypes.Start["namespaces"] {
  const namespaces: runDocsTypes.Start["namespaces"] = [];
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

function declarationsOf(
  agent: typesModule.Agent,
  options: runDocsTypes.CodemodeToolOptions,
): Declared {
  const tools = agent.callable.map((tool) => ({
    description: sampleOf(tool),
    jsName: toCodemodeIdentifier(tool.name),
    name: tool.name,
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
  return { globals, namespaces: namespacesOf(agent, options), tools };
}

const openRun = Effect.fnUntraced(function* (
  options: runDocsTypes.CodemodeToolOptions,
  sourceOptions: sourceTypes.CodemodeSourceOptions,
  api: typesModule.ToolExecutionApi,
  context: chordTypes.Context,
) {
  const declared = declarationsOf(yield* Effect.promise(() => api.agent(context)), options);
  const now = currentTimeMillis();
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return yield* commitWith(api, context, (tx) =>
    Effect.gen(function* () {
      const run = yield* Effect.promise(() => tx.doc(CodemodeRunDoc, api.taskId));
      if (run.result !== undefined) {
        const done: runStartTypes.OpenedRun = {
          done: copyJson(run.result as chordTypes.JsonValue) as typesModule.ToolExecutionResult,
        };
        return done;
      }
      const rerun = run.start !== undefined;
      if (run.start === undefined) {
        const store = yield* Effect.promise(() => tx.doc(CodemodeStoreDoc, api.conversationId));
        const timeout = sourceOptions.timeoutMs;
        run.start = {
          seed,
          startedAt: now,
          version: CODEMODE_MODULE_VERSION,
          ...(timeout === undefined ? {} : { deadline: now + timeout }),
          ...declared,
          maxOutputTokens: sourceOptions.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          store: copyJson(store.values as chordTypes.JsonValue) as Record<
            string,
            chordTypes.JsonValue
          >,
        };
      }
      const journal = yield* Effect.promise(() => tx.doc(CodemodeJournalDoc, api.taskId));
      const opened: runStartTypes.OpenedRun = {
        firstIssued: journal.firstIssued,
        journal: copyJson(
          journal.entries as unknown as chordTypes.JsonValue,
        ) as unknown as runDocsTypes.JournalEntry[],
        rerun,
        start: copyJson(
          run.start as unknown as chordTypes.JsonValue,
        ) as unknown as runDocsTypes.Start,
      };
      return opened;
    }),
  );
});

const remainingOf = (start: runDocsTypes.Start): number | undefined =>
  start.deadline === undefined ? undefined : start.deadline - currentTimeMillis();

const runStart = {
  openRun,
  remainingOf,
};

export default runStart;
