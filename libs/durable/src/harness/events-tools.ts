import type { Op, Path } from "@msa/chord/delta";
import { Function } from "effect";

import { startsWith } from "./events-messages.ts";
import type { AgentEvent, ToolEventCall } from "./events-types.ts";
import type { NestedToolSlot, ToolSlot } from "./live.ts";
import type { Dual2, Dual4, EntryRecord } from "./types.ts";

export type ToolUpdate =
  | Omit<Extract<AgentEvent, { type: "tool_execution_update" }>, "type" | keyof ToolEventCall>
  | undefined;

type Slot = ToolSlot | NestedToolSlot;

export const resultOf: Dual2<readonly EntryRecord[], string, EntryRecord | undefined> =
  Function.dual(2, (entries: readonly EntryRecord[], callId: string) =>
    entries.find((entry) => {
      const message = entry.model?.[0];
      return message?.role === "toolResult" && message.toolCallId === callId;
    }),
  );

export function callOf(slot: Slot): ToolEventCall {
  return {
    toolCallId: slot.callId,
    toolName: slot.name,
    ...(slot.taskId === undefined ? {} : { taskId: slot.taskId }),
    ...("parentCallId" in slot
      ? { parentToolCallId: slot.parentCallId, parentTaskId: slot.parentTaskId }
      : {}),
  };
}

type Appended = { readonly trimStart: number; readonly append: string; readonly set: boolean };

const appendedOutput = (
  viewOps: readonly Op[],
  outputPath: readonly (string | number)[],
): Appended => {
  let trimStart = 0;
  let append = "";
  let set = false;
  for (const op of viewOps) {
    if (!startsWith(op[1] as Path, outputPath)) continue;
    if (op[0] === "t") trimStart += op[2];
    else if (op[0] === "a") append += op[2];
    else set = true;
  }
  return { trimStart, append, set };
};

const outputUpdate = (
  appended: Appended,
  slot: Slot,
  previous: Slot,
): { trimStart?: number; append?: string } | { set: string } | undefined => {
  const { append, set, trimStart } = appended;
  if (set || (slot.output !== previous.output && trimStart === 0 && append === ""))
    return { set: slot.output ?? "" };
  if (trimStart > 0 || append !== "")
    return { ...(trimStart > 0 ? { trimStart } : {}), ...(append === "" ? {} : { append }) };
  return undefined;
};

export const toolUpdate: Dual4<
  readonly Op[],
  readonly ["tools" | "nestedTools", number],
  Slot,
  Slot,
  ToolUpdate
> = Function.dual(
  4,
  (
    viewOps: readonly Op[],
    at: readonly ["tools" | "nestedTools", number],
    slot: Slot,
    previous: Slot,
  ): ToolUpdate => {
    const outputPath = ["docs", "msa.live", ...at, "output"];
    const output = outputUpdate(appendedOutput(viewOps, outputPath), slot, previous);
    const update = {
      ...(output === undefined ? {} : { output }),
      ...(slot.details === previous.details ? {} : { details: slot.details ?? null }),
      ...(slot.diagnostics === previous.diagnostics ? {} : { diagnostics: slot.diagnostics ?? [] }),
    };
    return Object.keys(update).length === 0 ? undefined : update;
  },
);
