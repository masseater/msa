import type { Op } from "@msa/chord/delta";
import { Function } from "effect";

import eventsChanges from "./events-changes.ts";
import eventsSlots from "./events-slots.ts";
import eventsSnapshot from "./events-snapshot.ts";
import eventsStream from "./events-stream.ts";
import eventsTail from "./events-tail.ts";
import type eventsTypesModule from "./events-types.ts";
import type typesModule from "./types.types.ts";

const { collect, quiet } = eventsChanges;
const { parts } = eventsSnapshot;
const { endedNested, endedTools, slotsOf, startedTools, updatedTools } = eventsSlots;
const { partials, retryEvents, streamEvents } = eventsStream;
const { compactionEnds, entryEvents, tailEvents, taskEvents } = eventsTail;

const translate: typesModule.Dual5<
  typesModule.ConversationId,
  eventsTypesModule.Views,
  readonly Op[],
  typesModule.CommitPublication,
  Set<typesModule.TaskId>,
  eventsTypesModule.AgentEvent[]
> = Function.dual(
  5,
  (
    conversationId: typesModule.ConversationId,
    views: eventsTypesModule.Views,
    viewOps: readonly Op[],
    publication: typesModule.CommitPublication,
    held: Set<typesModule.TaskId>,
  ): eventsTypesModule.AgentEvent[] => {
    const changes = collect(publication, conversationId);
    if (quiet(viewOps, changes)) return [];
    const was = parts(views.before);
    const now = parts(views.after);
    const slots = slotsOf(was, now);
    const generations = partials(was, now);
    const toolEnds = endedTools(slots, changes);
    const tasks = taskEvents(changes, held);
    return [
      ...startedTools(slots, changes),
      ...streamEvents(generations, viewOps),
      ...updatedTools(slots, viewOps),
      ...retryEvents(was, now),
      ...endedNested(slots, changes),
      ...entryEvents(changes, generations, toolEnds),
      ...compactionEnds(was, now),
      ...tasks.events,
      ...(tasks.turnEnded ? [{ type: "turn_end" } as const] : []),
      ...tailEvents(was, now, changes),
    ];
  },
);

const eventsTranslate = {
  translate,
};

export default eventsTranslate;
