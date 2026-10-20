import { Function } from "effect";

import type typesModule from "../types.types.ts";
import errors from "../utils/errors.ts";
import type constrainedSamplingGrammarTypes from "./constrained-sampling-grammar.types.ts";

const { toErrorMessage } = errors;

interface JsonSchemaObject {
  [key: string]: unknown;
  type?: unknown;
  properties?: Record<string, JsonSchemaObject | undefined>;
  required?: unknown;
}

const getGrammarToolInput: {
  (arguments_: Record<string, unknown>, inputProperty: string): (toolName: string) => string;
  (toolName: string, arguments_: Record<string, unknown>, inputProperty: string): string;
} = Function.dual(
  3,
  function (toolName: string, arguments_: Record<string, unknown>, inputProperty: string): string {
    const input = arguments_[inputProperty];
    if (typeof input !== "string") {
      throw new TypeError(
        `Grammar tool call "${toolName}" requires argument "${inputProperty}" to be a string.`,
      );
    }
    return input;
  },
);

const appendGrammarToolInputJsonDelta: {
  (
    inputProperty: string,
    nextInput: string,
    close: boolean,
  ): (buffer: constrainedSamplingGrammarTypes.GrammarToolInputJsonBuffer) => string | undefined;
  (
    buffer: constrainedSamplingGrammarTypes.GrammarToolInputJsonBuffer,
    inputProperty: string,
    nextInput: string,
    close: boolean,
  ): string | undefined;
} = Function.dual(
  4,
  function (
    buffer: constrainedSamplingGrammarTypes.GrammarToolInputJsonBuffer,
    inputProperty: string,
    nextInput: string,
    close: boolean,
  ): string | undefined {
    if (buffer.closed) {
      if (close && nextInput === buffer.input) return undefined;
      throw new Error(
        `grammar tool input for property "${inputProperty}" changed after it was closed`,
      );
    }
    if (!nextInput.startsWith(buffer.input)) {
      throw new Error(
        `grammar tool input for property "${inputProperty}" changed non-monotonically`,
      );
    }

    const inputDelta = nextInput.slice(buffer.input.length);
    if (!close && inputDelta.length === 0) return undefined;

    let delta = "";
    if (!buffer.started) {
      delta += `{${JSON.stringify(inputProperty)}:"`;
      buffer.started = true;
    }
    delta += JSON.stringify(inputDelta).slice(1, -1);
    buffer.input = nextInput;

    if (close) {
      delta += '"}';
      buffer.closed = true;
    }
    return delta;
  },
);

function inferGrammarInputProperty(tool: typesModule.Tool): string {
  const schema = tool.parameters as JsonSchemaObject;
  if (schema.type !== "object") {
    throw new Error("grammar constrained sampling requires an object parameter schema");
  }
  if (
    !Array.isArray(schema.required) ||
    schema.required.length !== 1 ||
    typeof schema.required[0] !== "string"
  ) {
    throw new Error("grammar constrained sampling requires exactly one required string property");
  }

  const inputProperty = schema.required[0];
  if (schema.properties?.[inputProperty] === undefined) {
    throw new Error(
      `grammar constrained sampling requires a properties entry for ${inputProperty}`,
    );
  }
  if (schema.properties[inputProperty]?.type !== "string") {
    throw new Error(`grammar constrained sampling property ${inputProperty} must have type string`);
  }
  return inputProperty;
}

const resolveGrammarConstrainedSampling: {
  (
    supportsOpenAIGrammarTools: boolean,
  ): (
    tool: typesModule.Tool,
  ) => constrainedSamplingGrammarTypes.GrammarConstrainedSampling | undefined;
  (
    tool: typesModule.Tool,
    supportsOpenAIGrammarTools: boolean,
  ): constrainedSamplingGrammarTypes.GrammarConstrainedSampling | undefined;
} = Function.dual(2, function (tool: typesModule.Tool, supportsOpenAIGrammarTools: boolean):
  | constrainedSamplingGrammarTypes.GrammarConstrainedSampling
  | undefined {
  const config = tool.constrainedSampling;
  if (config === undefined || config === false || config.type !== "grammar") {
    return undefined;
  }

  if (!supportsOpenAIGrammarTools) {
    return undefined;
  }

  const larkDefinition = config.variants.openai_lark;
  const regexDefinition = config.variants.openai_regex;
  const hasLarkDefinition = typeof larkDefinition === "string" && larkDefinition.trim().length > 0;
  const hasRegexDefinition =
    typeof regexDefinition === "string" && regexDefinition.trim().length > 0;
  if (!hasLarkDefinition && !hasRegexDefinition) {
    throw new Error(
      `Tool "${tool.name}" cannot use grammar constrained sampling: no supported grammar variant was provided.`,
    );
  }

  try {
    return {
      definition: hasLarkDefinition ? larkDefinition : regexDefinition!,
      format: hasLarkDefinition ? "lark" : "regex",
      inputProperty: inferGrammarInputProperty(tool),
    };
  } catch (error) {
    const message = toErrorMessage(error);
    throw new Error(`Tool "${tool.name}" cannot use grammar constrained sampling: ${message}.`, {
      cause: error,
    });
  }
});

const createGrammarToolInputProperties: {
  (
    supportsOpenAIGrammarTools: boolean,
  ): (tools: typesModule.Tool[] | undefined) => ReadonlyMap<string, string>;
  (
    tools: typesModule.Tool[] | undefined,
    supportsOpenAIGrammarTools: boolean,
  ): ReadonlyMap<string, string>;
} = Function.dual(
  2,
  function (
    tools: typesModule.Tool[] | undefined,
    supportsOpenAIGrammarTools: boolean,
  ): ReadonlyMap<string, string> {
    const properties = new Map<string, string>();
    for (const tool of tools ?? []) {
      const grammar = resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools);
      if (grammar !== undefined) {
        properties.set(tool.name, grammar.inputProperty);
      }
    }
    return properties;
  },
);

const constrainedSamplingGrammar = {
  appendGrammarToolInputJsonDelta,
  createGrammarToolInputProperties,
  getGrammarToolInput,
  resolveGrammarConstrainedSampling,
};

export default constrainedSamplingGrammar;
