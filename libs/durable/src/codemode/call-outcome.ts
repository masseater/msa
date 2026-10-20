import type { TextContent } from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import type { CodemodeHostCall, CodemodeOutcome } from "@msa/codemode/portable";
import { Function } from "effect";

import type dualTypes from "../dual.ts";
import errorsModule from "../errors.ts";
import type typesModule from "../harness/types.types.ts";
import CallRows from "./call-rows.ts";
import modelsModule from "./models.ts";

const { MODEL_CALLS } = modelsModule;
const { errorMessage } = errorsModule;

const isText = (item: unknown): item is TextContent =>
  typeof item === "object" && item !== null && (item as TextContent).type === "text";

function textOf(value: JsonValue | undefined): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((item) => (isText(item) ? [item.text] : [])).join("\n");
}

const firstNonEmpty = (...texts: string[]): string | undefined => texts.find((text) => text !== "");

const outcomeOf: dualTypes.Dual3<
  string,
  boolean,
  typesModule.NestedToolExecutionResult,
  CodemodeOutcome
> = Function.dual(
  3,
  (
    name: string,
    structured: boolean,
    result: typesModule.NestedToolExecutionResult,
  ): CodemodeOutcome => {
    const value = structured ? result.structuredOutput : textOf(result.structuredOutput);
    if (result.isError !== true || (structured && value !== undefined)) return { ok: true, value };
    const message = structured ? "" : (value as string);
    const diagnostics = result.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.message)
      .join("\n");
    return {
      message: firstNonEmpty(message, diagnostics) ?? `Tool ${name} failed`,
      ok: false,
      ...(value === undefined ? {} : { properties: { structuredOutput: value } }),
    };
  },
);

function asToolCall(call: CodemodeHostCall): CodemodeHostCall {
  const tool = call.target === "global" ? MODEL_CALLS[call.name] : undefined;
  if (tool === undefined) return call;
  const [model, context] = Array.isArray(call.args) ? call.args : [];
  return {
    args: { context: context ?? null, model: model ?? null },
    id: call.id,
    name: tool,
    target: "tool",
  };
}

function countImages(value: unknown): number {
  const output =
    typeof value === "object" && value !== null
      ? (value as { output?: unknown }).output
      : undefined;
  return Array.isArray(output)
    ? output.filter((item) => (item as { type?: unknown } | undefined)?.type === "image").length
    : 0;
}

const describeCall = (call: CodemodeHostCall): string =>
  `${call.target === "tool" ? "tools." : ""}${call.name}(${JSON.stringify(call.args) ?? ""})`;

const madeCall: dualTypes.Dual2<string, unknown, string> = Function.dual(
  2,
  (name: string, args: unknown): string => `tools.${name}(${JSON.stringify(args)})`,
);

const failedCall: dualTypes.Dual2<CodemodeHostCall, unknown, string> = Function.dual(
  2,
  (call: CodemodeHostCall, error: unknown): string =>
    `call ${call.id} is ${describeCall(call)}: ${errorMessage(error)}`,
);

const sameJsonOf = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJsonOf(item, b[i]))
    );
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        sameJsonOf((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
};

const sameJson: dualTypes.Dual2<unknown, unknown, boolean> = Function.dual(2, sameJsonOf);

const callRows = {
  CallRows,
  asToolCall,
  countImages,
  describeCall,
  failedCall,
  madeCall,
  outcomeOf,
  sameJson,
};

export default callRows;
