import type codemodeTypes from "@msa/codemode/index.types";
import { Type } from "typebox";

const CODEMODE_TOOL_NAME = "codemode";

const CODEMODE_STORE_ENTRY_TYPE = "codemode-store";

const TEXT_OUTPUT_SCHEMA: codemodeTypes.CodemodeJsonSchema = { type: "string" };

const codemodeSchema = Type.Object({
  code: Type.String({
    description: "Raw JavaScript source.",
  }),
});

const codemodeToolSystemPromptContribution = {
  guidelines: [
    "Use codemode to batch independent tool calls (Promise.allSettled), chain them, or filter large output, instead of many separate calls.",
  ],
  snippet: "Run JavaScript that calls other tools",
} as const;

const toolSchema = {
  CODEMODE_STORE_ENTRY_TYPE,
  CODEMODE_TOOL_NAME,
  TEXT_OUTPUT_SCHEMA,
  codemodeSchema,
  codemodeToolSystemPromptContribution,
};

export default toolSchema;
