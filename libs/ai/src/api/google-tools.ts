import { FunctionCallingConfigMode } from "@google/genai";
import { Function } from "effect";

import type { Tool } from "../types.ts";
import {
  getJsonSchemaToolParameters,
  resolveJsonSchemaStrictSampling,
} from "./constrained-sampling.ts";
import { getGeminiMajorVersion } from "./google-messages.ts";

const JSON_SCHEMA_META_DECLARATIONS = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$vocabulary",
  "$comment",
  "$defs",
  "definitions",
]);

function sanitizeForOpenApi(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return schema;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (JSON_SCHEMA_META_DECLARATIONS.has(key)) continue;
    result[key] = sanitizeForOpenApi(value);
  }
  return result;
}

export const convertTools: {
  (
    useParameters?: boolean,
    supportsStrictMode?: boolean,
  ): (tools: Tool[]) => { functionDeclarations: Record<string, unknown>[] }[] | undefined;
  (
    tools: Tool[],
    useParameters?: boolean,
    supportsStrictMode?: boolean,
  ): { functionDeclarations: Record<string, unknown>[] }[] | undefined;
} = Function.dual(
  (args) => Array.isArray(args[0]),
  function (
    tools: Tool[],
    useParameters: boolean = false,
    supportsStrictMode: boolean = true,
  ): { functionDeclarations: Record<string, unknown>[] }[] | undefined {
    if (tools.length === 0) return undefined;
    return [
      {
        functionDeclarations: tools.map((tool) => {
          const strict = resolveJsonSchemaStrictSampling(tool, supportsStrictMode);
          const parameters = getJsonSchemaToolParameters(tool, strict);
          return {
            name: tool.name,
            description: tool.description,
            ...(useParameters
              ? { parameters: sanitizeForOpenApi(parameters as unknown) }
              : { parametersJsonSchema: parameters }),
          };
        }),
      },
    ];
  },
);

export function supportsGoogleStrictToolSampling(modelId: string): boolean {
  const majorVersion = getGeminiMajorVersion(modelId);
  return majorVersion !== undefined && majorVersion >= 3;
}

export function mapToolChoice(choice: string): FunctionCallingConfigMode {
  switch (choice) {
    case "auto":
      return FunctionCallingConfigMode.AUTO;
    case "none":
      return FunctionCallingConfigMode.NONE;
    case "any":
      return FunctionCallingConfigMode.ANY;
    default:
      return FunctionCallingConfigMode.AUTO;
  }
}

export const resolveGoogleFunctionCallingMode: {
  (
    toolChoice: string | undefined,
    supportsStrictMode: boolean,
  ): (tools: Tool[]) => FunctionCallingConfigMode | undefined;
  (
    tools: Tool[],
    toolChoice: string | undefined,
    supportsStrictMode: boolean,
  ): FunctionCallingConfigMode | undefined;
} = Function.dual(
  3,
  function (
    tools: Tool[],
    toolChoice: string | undefined,
    supportsStrictMode: boolean,
  ): FunctionCallingConfigMode | undefined {
    const useStrictMode = tools.some(
      (tool) => resolveJsonSchemaStrictSampling(tool, supportsStrictMode) === true,
    );
    if (toolChoice === "none" || toolChoice === "any") {
      return mapToolChoice(toolChoice);
    }
    if (useStrictMode) {
      return FunctionCallingConfigMode.VALIDATED;
    }
    return toolChoice !== undefined && toolChoice !== "" ? mapToolChoice(toolChoice) : undefined;
  },
);
