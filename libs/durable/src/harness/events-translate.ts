import type { Op } from "@msa/chord/delta";
import { Function } from "effect";

import { collect, quiet } from "./events-changes.ts";
import { endedNested, endedTools, slotsOf, startedTools, updatedTools } from "./events-slots.ts";
import { parts } from "./events-snapshot.ts";
import { partials, retryEvents, streamEvents } from "./events-stream.ts";
import { compactionEnds, entryEvents, taskEvents, tailEvents } from "./events-tail.ts";
import type { AgentEvent, Views } from "./events-types.ts";
import type { CommitPublication, ConversationId, Dual5, TaskId } from "./types.ts";

export const translate: Dual5<
  ConversationId,
  Views,
  readonly Op[],
  CommitPublication,
  Set<TaskId>,
  AgentEvent[]
> = Function.dual(
  5,
  (
    conversationId: ConversationId,
    views: Views,
    viewOps: readonly Op[],
    publication: CommitPublication,
    held: Set<TaskId>,
  ): AgentEvent[] => {
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
