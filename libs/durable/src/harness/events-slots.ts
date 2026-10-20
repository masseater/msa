import type { Op } from "@msa/chord/delta";
import { Function } from "effect";

import type eventsChangesTypes from "./events-changes.types.ts";
import type eventsSlotsTypes from "./events-slots.types.ts";
import type eventsSnapshotTypes from "./events-snapshot.types.ts";
import eventsTools from "./events-tools.ts";
import type eventsTypesModule from "./events-types.ts";
import type liveTypes from "./live.types.ts";
import type typesModule from "./types.types.ts";

const { callOf, resultOf, toolUpdate } = eventsTools;

const slotsOf: typesModule.Dual2<
  eventsSnapshotTypes.Parts,
  eventsSnapshotTypes.Parts,
  eventsSlotsTypes.Slots
> = Function.dual(
  2,
  (was: eventsSnapshotTypes.Parts, now: eventsSnapshotTypes.Parts): eventsSlotsTypes.Slots => ({
    nested: now.live.nestedTools ?? [],
    nestedBefore: new Map((was.live.nestedTools ?? []).map((slot) => [slot.taskId, slot])),
    slots: now.live.tools ?? [],
    slotsBefore: new Map((was.live.tools ?? []).map((slot) => [slot.callId, slot])),
  }),
);

const argumentsOf = (
  slot: liveTypes.ToolSlot | liveTypes.NestedToolSlot,
  changes: eventsChangesTypes.Changes,
): typesModule.JsonObject => {
  if ("parentCallId" in slot) return slot.arguments;
  const checkpoint =
    slot.taskId === undefined ? undefined : changes.tasks.get(slot.taskId)?.state.checkpoint;
  return (checkpoint as { arguments?: typesModule.JsonObject } | undefined)?.arguments ?? {};
};

const startedTools: typesModule.Dual2<
  eventsSlotsTypes.Slots,
  eventsChangesTypes.Changes,
  eventsTypesModule.AgentEvent[]
> = Function.dual(
  2,
  (
    slots: eventsSlotsTypes.Slots,
    changes: eventsChangesTypes.Changes,
  ): eventsTypesModule.AgentEvent[] => {
    const events: eventsTypesModule.AgentEvent[] = [];
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

const updatedTools: typesModule.Dual2<
  eventsSlotsTypes.Slots,
  readonly Op[],
  eventsTypesModule.AgentEvent[]
> = Function.dual(
  2,
  (slots: eventsSlotsTypes.Slots, viewOps: readonly Op[]): eventsTypesModule.AgentEvent[] => {
    const events: eventsTypesModule.AgentEvent[] = [];
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

const endedTools: typesModule.Dual2<
  eventsSlotsTypes.Slots,
  eventsChangesTypes.Changes,
  readonly eventsSlotsTypes.ToolEnd[]
> = Function.dual(
  2,
  (
    slots: eventsSlotsTypes.Slots,
    changes: eventsChangesTypes.Changes,
  ): readonly eventsSlotsTypes.ToolEnd[] => {
    const ends: eventsSlotsTypes.ToolEnd[] = [];
    const endTool = (slot: liveTypes.ToolSlot, entryId: number | undefined): void => {
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

const endedNested: typesModule.Dual2<
  eventsSlotsTypes.Slots,
  eventsChangesTypes.Changes,
  eventsTypesModule.AgentEvent[]
> = Function.dual(
  2,
  (
    slots: eventsSlotsTypes.Slots,
    changes: eventsChangesTypes.Changes,
  ): eventsTypesModule.AgentEvent[] => {
    const events: eventsTypesModule.AgentEvent[] = [];
    const endNested = (slot: liveTypes.NestedToolSlot): void => {
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

const eventsSlots = {
  endedNested,
  endedTools,
  slotsOf,
  startedTools,
  updatedTools,
};

export default eventsSlots;
