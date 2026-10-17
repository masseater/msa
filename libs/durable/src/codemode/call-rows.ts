import type { TextContent } from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import type { CodemodeHostCall, CodemodeOutcome } from "@msa/codemode/portable";
import { Function } from "effect";

import type { Dual2, Dual3 } from "../dual.ts";
import { errorMessage } from "../errors.ts";
import type { NestedToolExecutionResult } from "../harness/types.ts";
import { CODEMODE_INTERNAL_PREFIX, MODEL_CALLS } from "./models.ts";

export type CodemodeNestedCall = {
  id: number;
  name: string;
  args: string;
  status: "running" | "ok" | "error" | "cancelled";
  durationMs?: number;
  error?: string;
};

export type CodemodeToolDetails = {
  calls: CodemodeNestedCall[];
  fullOutputPath?: string;
};

const ARGS_PREVIEW_CHARS = 200;
const ERROR_PREVIEW_CHARS = 500;

const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 3)}...` : text;

const isText = (item: unknown): item is TextContent =>
  typeof item === "object" && item !== null && (item as TextContent).type === "text";

function textOf(value: JsonValue | undefined): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((item) => (isText(item) ? [item.text] : [])).join("\n");
}

const firstNonEmpty = (...texts: string[]): string | undefined => texts.find((text) => text !== "");

export const outcomeOf: Dual3<string, boolean, NestedToolExecutionResult, CodemodeOutcome> =
  Function.dual(
    3,
    (name: string, structured: boolean, result: NestedToolExecutionResult): CodemodeOutcome => {
      const value = structured ? result.structuredOutput : textOf(result.structuredOutput);
      if (result.isError !== true || (structured && value !== undefined))
        return { ok: true, value };
      const message = structured ? "" : (value as string);
      const diagnostics = result.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.message)
        .join("\n");
      return {
        ok: false,
        message: firstNonEmpty(message, diagnostics) ?? `Tool ${name} failed`,
        ...(value === undefined ? {} : { properties: { structuredOutput: value } }),
      };
    },
  );

export function asToolCall(call: CodemodeHostCall): CodemodeHostCall {
  const tool = call.target === "global" ? MODEL_CALLS[call.name] : undefined;
  if (tool === undefined) return call;
  const [model, context] = Array.isArray(call.args) ? call.args : [];
  return {
    id: call.id,
    target: "tool",
    name: tool,
    args: { model: model ?? null, context: context ?? null },
  };
}

export function countImages(value: unknown): number {
  const output =
    typeof value === "object" && value !== null
      ? (value as { output?: unknown }).output
      : undefined;
  return Array.isArray(output)
    ? output.filter((item) => (item as { type?: unknown } | undefined)?.type === "image").length
    : 0;
}

export const describeCall = (call: CodemodeHostCall): string =>
  `${call.target === "tool" ? "tools." : ""}${call.name}(${JSON.stringify(call.args) ?? ""})`;

export const madeCall: Dual2<string, unknown, string> = Function.dual(
  2,
  (name: string, args: unknown): string => `tools.${name}(${JSON.stringify(args)})`,
);

export const failedCall: Dual2<CodemodeHostCall, unknown, string> = Function.dual(
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

export const sameJson: Dual2<unknown, unknown, boolean> = Function.dual(2, sameJsonOf);

export class CallRows {
  readonly #rows = new Map<number, CodemodeNestedCall>();

  started(call: CodemodeHostCall): void {
    if (this.#rows.has(call.id)) return;
    const args = call.args === undefined ? "" : (JSON.stringify(call.args) ?? "");
    const name = call.name.startsWith(CODEMODE_INTERNAL_PREFIX)
      ? call.name.slice(CODEMODE_INTERNAL_PREFIX.length)
      : call.name;
    this.#rows.set(call.id, {
      id: call.id,
      name,
      args: cut(args, ARGS_PREVIEW_CHARS),
      status: "running",
    });
  }

  finished(id: number, outcome: CodemodeOutcome, result: NestedToolExecutionResult): void {
    const row = this.#rows.get(id);
    if (row === undefined) return;
    row.status = result.isError === true ? "error" : "ok";
    if (result.durationMs !== undefined) row.durationMs = result.durationMs;
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const error = outcome.ok
      ? errors.map((diagnostic) => diagnostic.message).join("\n")
      : outcome.message;
    if (result.isError === true && error !== "") row.error = cut(error, ERROR_PREVIEW_CHARS);
  }

  details(): CodemodeToolDetails {
    const calls = [...this.#rows.values()]
      .sort((a, b) => a.id - b.id)
      .map((row) =>
        row.status === "running" ? Object.assign({}, row, { status: "cancelled" as const }) : row,
      );
    return { calls };
  }
}
