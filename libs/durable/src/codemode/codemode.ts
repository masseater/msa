import { CODEMODE_SOURCE_GRAMMAR, parseCodemodeSource } from "@msa/codemode/source";
import { Effect } from "effect";
import { type Static, Type } from "typebox";

import { defineExtension, defineTool, section } from "../harness/define.ts";
import type { Extension, ToolRegistration } from "../harness/types.ts";
import {
  codemodeDescription,
  codemodeSection,
  DEFAULT_CODEMODE_INLINE_BUDGET,
} from "./describe.ts";
import { CODEMODE_INTERNAL_PREFIX, createModelTools } from "./models.ts";
import { runCodemode } from "./run-call.ts";
import { type CodemodeToolOptions, OUTPUT_LIMITS } from "./run-docs.ts";

export type { CodemodeNestedCall, CodemodeToolDetails } from "./call-rows.ts";
export {
  CODEMODE_MODULE_VERSION,
  type CodemodeGlobal,
  CodemodeJournalDoc,
  CodemodeRunDoc,
  CodemodeStoreDoc,
  type CodemodeToolOptions,
} from "./run-docs.ts";

export const CODEMODE_TOOL_NAME = "codemode";

const codemodeSchema = Type.Object({
  code: Type.String({ description: "Raw JavaScript source." }),
});

export type CodemodeToolInput = Static<typeof codemodeSchema>;

export function createCodemodeTool(
  options: CodemodeToolOptions,
): ToolRegistration<typeof codemodeSchema> {
  return defineTool({
    name: CODEMODE_TOOL_NAME,
    description: codemodeDescription(options.models !== false),
    parameters: codemodeSchema,
    outputLimits: OUTPUT_LIMITS,
    constrainedSampling: { type: "grammar", variants: { openai_lark: CODEMODE_SOURCE_GRAMMAR } },
    callers: ["model"],
    replay: "safe",
    execute: (args, api, context) =>
      Effect.runPromise(
        Effect.suspend(() => runCodemode(options, api, context, parseCodemodeSource(args.code))),
      ),
  });
}

export function createCodemodeExtension(options: CodemodeToolOptions): Extension {
  return defineExtension({
    name: "codemode",
    tools: [createCodemodeTool(options), ...(options.models === false ? [] : createModelTools())],
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
  });
}
