import * as Schema from "effect/Schema";

import type sourceTypes from "./source.types.ts";

const CODEMODE_OPTIONS_PREFIX = "// @options:";

const SUPPORTED_FIELDS = ["max_output_tokens", "timeout_ms"] as const;
const SUPPORTED_FIELDS_TEXT = "`max_output_tokens` and `timeout_ms`";
const MAX_TIMEOUT_MS = 2_147_483_647;

const CODEMODE_SOURCE_GRAMMAR = String.raw`
start: options_source | plain_source
options_source: OPTIONS_LINE NEWLINE SOURCE
plain_source: SOURCE

OPTIONS_LINE: /[ \t]*\/\/ @options:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
`;

class CodemodeSourceError extends Schema.TaggedError<
  CodemodeSourceError,
  { readonly brand: unique symbol }
>()("CodemodeSourceError", { message: Schema.String }) {
  static create(message: string): CodemodeSourceError {
    return CodemodeSourceError.make({ message });
  }
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseOptions(directive: string): sourceTypes.CodemodeSourceOptions {
  if (directive === "") {
    throw CodemodeSourceError.create(
      `@options must be a JSON object with supported fields ${SUPPORTED_FIELDS_TEXT}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(directive);
  } catch (error) {
    throw CodemodeSourceError.create(
      `@options must be valid JSON with supported fields ${SUPPORTED_FIELDS_TEXT}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw CodemodeSourceError.create(
      `@options must be a JSON object with supported fields ${SUPPORTED_FIELDS_TEXT}`,
    );
  }
  const fields = value as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!(SUPPORTED_FIELDS as readonly string[]).includes(key)) {
      throw CodemodeSourceError.create(
        `@options only supports ${SUPPORTED_FIELDS_TEXT}; got \`${key}\``,
      );
    }
  }
  const options: sourceTypes.CodemodeSourceOptions = {};
  const { max_output_tokens, timeout_ms } = fields;
  if (max_output_tokens !== undefined) {
    if (!isSafeInteger(max_output_tokens)) {
      throw CodemodeSourceError.create(
        "@options field `max_output_tokens` must be a non-negative safe integer",
      );
    }
    options.maxOutputTokens = max_output_tokens;
  }
  if (timeout_ms !== undefined) {
    if (!isSafeInteger(timeout_ms) || timeout_ms === 0 || timeout_ms > MAX_TIMEOUT_MS) {
      throw CodemodeSourceError.create(
        `@options field \`timeout_ms\` must be a positive integer up to ${MAX_TIMEOUT_MS}`,
      );
    }
    options.timeoutMs = timeout_ms;
  }
  return options;
}

function parseCodemodeSource(input: string): sourceTypes.ParsedCodemodeSource {
  if (input.trim() === "") {
    throw CodemodeSourceError.create(
      'Expected JavaScript source text (non-empty). Provide JS only, optionally with a first line `// @options: {"max_output_tokens": 1000}`.',
    );
  }
  const lines = input.split("\n");
  const misplaced = lines.findIndex(
    (line, index) => index > 0 && line.trimStart().startsWith(CODEMODE_OPTIONS_PREFIX),
  );
  if (misplaced !== -1) {
    throw CodemodeSourceError.create(
      `The ${CODEMODE_OPTIONS_PREFIX} line must be the first line of the input; found one on line ${misplaced + 1}`,
    );
  }
  const newline = input.indexOf("\n");
  const firstLine = (newline === -1 ? input : input.slice(0, newline)).replace(/\r$/u, "");
  const trimmed = firstLine.trimStart();
  if (!trimmed.startsWith(CODEMODE_OPTIONS_PREFIX)) return { code: input, options: {} };
  const code = newline === -1 ? "" : input.slice(newline);
  if (code.trim() === "") {
    throw CodemodeSourceError.create(
      "The @options line must be followed by JavaScript source on subsequent lines",
    );
  }
  return { code, options: parseOptions(trimmed.slice(CODEMODE_OPTIONS_PREFIX.length).trim()) };
}

const source = {
  CODEMODE_OPTIONS_PREFIX,
  CODEMODE_SOURCE_GRAMMAR,
  CodemodeSourceError,
  parseCodemodeSource,
};

export default source;
