import type { Op } from "@msa/chord/delta";
import { Function } from "effect";

import type { Changes } from "./events-changes.ts";
import type { Parts } from "./events-snapshot.ts";
import { callOf, resultOf, toolUpdate } from "./events-tools.ts";
import type { AgentEvent } from "./events-types.ts";
import type { NestedToolSlot, ToolSlot } from "./live.ts";
import type { Dual2, JsonObject } from "./types.ts";

export type Slots = {
  readonly slotsBefore: Map<string, ToolSlot>;
  readonly slots: readonly ToolSlot[];
  readonly nestedBefore: Map<TaskKey, NestedToolSlot>;
  readonly nested: readonly NestedToolSlot[];
};

type TaskKey = NestedToolSlot["taskId"];

export type ToolEnd = Extract<AgentEvent, { type: "tool_execution_end" }>;

export const slotsOf: Dual2<Parts, Parts, Slots> = Function.dual(
  2,
  (was: Parts, now: Parts): Slots => ({
    slotsBefore: new Map((was.live.tools ?? []).map((slot) => [slot.callId, slot])),
    slots: now.live.tools ?? [],
    nestedBefore: new Map((was.live.nestedTools ?? []).map((slot) => [slot.taskId, slot])),
    nested: now.live.nestedTools ?? [],
  }),
);

const argumentsOf = (slot: ToolSlot | NestedToolSlot, changes: Changes): JsonObject => {
  if ("parentCallId" in slot) return slot.arguments;
  const checkpoint =
    slot.taskId === undefined ? undefined : changes.tasks.get(slot.taskId)?.state.checkpoint;
  return (checkpoint as { arguments?: JsonObject } | undefined)?.arguments ?? {};
};

export const startedTools: Dual2<Slots, Changes, AgentEvent[]> = Function.dual(
  2,
  (slots: Slots, changes: Changes): AgentEvent[] => {
    const events: AgentEvent[] = [];
    for (const slot of [...slots.slots, ...slots.nested]) {
      const previous =
        "parentCallId" in slot
          ? slots.nestedBefore.get(slot.taskId)
          : slots.slotsBefore.get(slot.callId);
      if (slot.status !== "running" || previous?.status === "running") continue;
      events.push({
        type: "tool_execution_start",
        ...callOf(slot),
        args: argumentsOf(slot, changes),
      });
    }
    return events;
  },
);

export const updatedTools: Dual2<Slots, readonly Op[], AgentEvent[]> = Function.dual(
  2,
  (slots: Slots, viewOps: readonly Op[]): AgentEvent[] => {
    const events: AgentEvent[] = [];
    for (const [index, slot] of slots.slots.entries()) {
      const previous = slots.slotsBefore.get(slot.callId);
      if (slot.status !== "running" || previous?.status !== "running") continue;
      const update = toolUpdate(viewOps, ["tools", index], slot, previous);
      if (update !== undefined)
        events.push({ type: "tool_execution_update", ...callOf(slot), ...update });
    }
    for (const [index, slot] of slots.nested.entries()) {
      const previous = slots.nestedBefore.get(slot.taskId);
      if (slot.status !== "running" || previous?.status !== "running") continue;
      const update = toolUpdate(viewOps, ["nestedTools", index], slot, previous);
      if (update !== undefined)
        events.push({ type: "tool_execution_update", ...callOf(slot), ...update });
    }
    return events;
  },
);

export const endedTools: Dual2<Slots, Changes, readonly ToolEnd[]> = Function.dual(
  2,
  (slots: Slots, changes: Changes): readonly ToolEnd[] => {
    const ends: ToolEnd[] = [];
    const endTool = (slot: ToolSlot, entryId: number | undefined): void => {
      const entry = changes.entries.find((candidate) => candidate.id === entryId);
      ends.push({
        type: "tool_execution_end",
        ...callOf(slot),
        ...(entry === undefined ? {} : { entry }),
      });
    };
    for (const previous of slots.slotsBefore.values()) {
      if (previous.status === "done") continue;
      const slot = slots.slots.find((candidate) => candidate.callId === previous.callId);
      if (slot?.status === "done") endTool(slot, slot.entry);
      else if (slot === undefined)
        endTool(previous, resultOf(changes.entries, previous.callId)?.id);
    }
    for (const slot of slots.slots)
      if (slot.status === "done" && !slots.slotsBefore.has(slot.callId)) endTool(slot, slot.entry);
    return ends;
  },
);

export const endedNested: Dual2<Slots, Changes, AgentEvent[]> = Function.dual(
  2,
  (slots: Slots, changes: Changes): AgentEvent[] => {
    const events: AgentEvent[] = [];
    const endNested = (slot: NestedToolSlot): void => {
      const result = changes.nestedResults.get(slot.taskId);
      events.push({
        type: "tool_execution_end",
        ...callOf(slot),
        ...(result === undefined ? {} : { result }),
      });
    };
    const nestedNow = new Map(slots.nested.map((slot) => [slot.taskId, slot]));
    for (const previous of [...slots.nestedBefore.values()].reverse()) {
      if (previous.status === "done") continue;
      const slot = nestedNow.get(previous.taskId);
      if (slot?.status === "done" || slot === undefined) endNested(slot ?? previous);
    }
    for (const slot of [...slots.nested].reverse())
      if (slot.status === "done" && !slots.nestedBefore.has(slot.taskId)) endNested(slot);
    return events;
  },
);
