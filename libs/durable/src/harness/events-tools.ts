import type { Op, Path } from "@msa/chord/delta";
import { Function } from "effect";

import eventsMessages from "./events-messages.ts";
import type eventsToolsTypes from "./events-tools.types.ts";
import type eventsTypesModule from "./events-types.ts";
import type liveTypes from "./live.types.ts";
import type typesModule from "./types.types.ts";

const { startsWith } = eventsMessages;

type Slot = liveTypes.ToolSlot | liveTypes.NestedToolSlot;

const resultOf: typesModule.Dual2<
  readonly typesModule.EntryRecord[],
  string,
  typesModule.EntryRecord | undefined
> = Function.dual(2, (entries: readonly typesModule.EntryRecord[], callId: string) =>
  entries.find((entry) => {
    const message = entry.model?.[0];
    return message?.role === "toolResult" && message.toolCallId === callId;
  }),
);

function callOf(slot: Slot): eventsTypesModule.ToolEventCall {
  return {
    toolCallId: slot.callId,
    toolName: slot.name,
    ...(slot.taskId === undefined ? {} : { taskId: slot.taskId }),
    ...("parentCallId" in slot
      ? { parentTaskId: slot.parentTaskId, parentToolCallId: slot.parentCallId }
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
  return { append, set, trimStart };
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

const toolUpdate: typesModule.Dual4<
  readonly Op[],
  readonly ["tools" | "nestedTools", number],
  Slot,
  Slot,
  eventsToolsTypes.ToolUpdate
> = Function.dual(
  4,
  (
    viewOps: readonly Op[],
    at: readonly ["tools" | "nestedTools", number],
    slot: Slot,
    previous: Slot,
  ): eventsToolsTypes.ToolUpdate => {
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

const eventsTools = {
  callOf,
  resultOf,
  toolUpdate,
};

export default eventsTools;
