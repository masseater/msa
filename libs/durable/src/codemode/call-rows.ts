import type { CodemodeHostCall, CodemodeOutcome } from "@msa/codemode/portable";

import type typesModule from "../harness/types.types.ts";
import type callRowsTypes from "./call-rows.types.ts";
import modelsModule from "./models.ts";

const { CODEMODE_INTERNAL_PREFIX } = modelsModule;

const ARGS_PREVIEW_CHARS = 200;

const ERROR_PREVIEW_CHARS = 500;

const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 3)}...` : text;

export default class CallRows {
  readonly #rows = new Map<number, callRowsTypes.CodemodeNestedCall>();

  started(call: CodemodeHostCall): void {
    if (this.#rows.has(call.id)) return;
    const args = call.args === undefined ? "" : (JSON.stringify(call.args) ?? "");
    const name = call.name.startsWith(CODEMODE_INTERNAL_PREFIX)
      ? call.name.slice(CODEMODE_INTERNAL_PREFIX.length)
      : call.name;
    this.#rows.set(call.id, {
      args: cut(args, ARGS_PREVIEW_CHARS),
      id: call.id,
      name,
      status: "running",
    });
  }

  finished(
    id: number,
    outcome: CodemodeOutcome,
    result: typesModule.NestedToolExecutionResult,
  ): void {
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

  details(): callRowsTypes.CodemodeToolDetails {
    const calls = [...this.#rows.values()]
      .sort((a, b) => a.id - b.id)
      .map((row) =>
        row.status === "running" ? Object.assign({}, row, { status: "cancelled" as const }) : row,
      );
    return { calls };
  }
}
