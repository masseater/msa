import source from "@msa/codemode/source";
import { Effect } from "effect";
import { Type } from "typebox";

import define from "../harness/define.ts";
import type typesModule from "../harness/types.types.ts";
import describe from "./describe.ts";
import modelsModule from "./models.ts";
import runCall from "./run-call.ts";
import runDocs from "./run-docs.ts";
import type runDocsTypes from "./run-docs.types.ts";

const { CODEMODE_SOURCE_GRAMMAR, parseCodemodeSource } = source;

const { defineExtension, defineTool, section } = define;
const { DEFAULT_CODEMODE_INLINE_BUDGET, codemodeDescription, codemodeSection } = describe;
const { runCodemode } = runCall;
const { OUTPUT_LIMITS } = runDocs;
const { CODEMODE_INTERNAL_PREFIX, createModelTools } = modelsModule;

const CODEMODE_TOOL_NAME = "codemode";

const codemodeSchema = Type.Object({
  code: Type.String({ description: "Raw JavaScript source." }),
});

function createCodemodeTool(
  options: runDocsTypes.CodemodeToolOptions,
): typesModule.ToolRegistration<typeof codemodeSchema> {
  return defineTool({
    callers: ["model"],
    constrainedSampling: { type: "grammar", variants: { openai_lark: CODEMODE_SOURCE_GRAMMAR } },
    description: codemodeDescription(options.models !== false),
    execute: (args, api, context) =>
      Effect.runPromise(
        Effect.suspend(() => runCodemode(options, api, context, parseCodemodeSource(args.code))),
      ),
    name: CODEMODE_TOOL_NAME,
    outputLimits: OUTPUT_LIMITS,
    parameters: codemodeSchema,
    replay: "safe",
  });
}

function createCodemodeExtension(options: runDocsTypes.CodemodeToolOptions): typesModule.Extension {
  return defineExtension({
    name: "codemode",
    sections: [
      section("codemode", (input) =>
        codemodeSection(
          input.agent.callable.filter(
            (tool) => !tool.name.startsWith(CODEMODE_INTERNAL_PREFIX) && tool.deferred !== true,
          ),
          options.namespaces ?? [],
          options.inlineBudget ?? DEFAULT_CODEMODE_INLINE_BUDGET,
        ),
      ),
    ],
    tools: [createCodemodeTool(options), ...(options.models === false ? [] : createModelTools())],
  });
}

const codemode = {
  CODEMODE_MODULE_VERSION: runDocs.CODEMODE_MODULE_VERSION,
  CODEMODE_TOOL_NAME,
  CodemodeJournalDoc: runDocs.CodemodeJournalDoc,
  CodemodeRunDoc: runDocs.CodemodeRunDoc,
  CodemodeStoreDoc: runDocs.CodemodeStoreDoc,
  codemodeSchema,
  createCodemodeExtension,
  createCodemodeTool,
};

export default codemode;
