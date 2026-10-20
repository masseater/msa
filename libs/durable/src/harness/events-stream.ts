import type { AssistantMessage } from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import { Function } from "effect";

import eventsMessages from "./events-messages.ts";
import type eventsSnapshotTypes from "./events-snapshot.types.ts";
import type eventsStreamTypes from "./events-stream.types.ts";
import type eventsTypesModule from "./events-types.ts";
import type typesModule from "./types.types.ts";

const { messageChanges } = eventsMessages;

const partials: typesModule.Dual2<
  eventsSnapshotTypes.Parts,
  eventsSnapshotTypes.Parts,
  eventsStreamTypes.Generations
> = Function.dual(
  2,
  (
    was: eventsSnapshotTypes.Parts,
    now: eventsSnapshotTypes.Parts,
  ): eventsStreamTypes.Generations => ({
    partial: now.live.generation?.message as AssistantMessage | undefined,
    partialBefore: was.live.generation?.message as AssistantMessage | undefined,
  }),
);

const streamEvents: typesModule.Dual2<
  eventsStreamTypes.Generations,
  readonly Op[],
  eventsTypesModule.AgentEvent[]
> = Function.dual(
  2,
  (
    generations: eventsStreamTypes.Generations,
    viewOps: readonly Op[],
  ): eventsTypesModule.AgentEvent[] => {
    const { partial, partialBefore } = generations;
    if (partial === undefined) return [];
    if (partialBefore === undefined) return [{ message: partial, type: "message_start" }];
    if (partial === partialBefore) return [];
    return [
      {
        changes: messageChanges(viewOps, partial),
        type: "message_update",
        usage: partial.usage,
      },
    ];
  },
);

const retryEvents: typesModule.Dual2<
  eventsSnapshotTypes.Parts,
  eventsSnapshotTypes.Parts,
  eventsTypesModule.AgentEvent[]
> = Function.dual(
  2,
  (
    was: eventsSnapshotTypes.Parts,
    now: eventsSnapshotTypes.Parts,
  ): eventsTypesModule.AgentEvent[] => {
    const events: eventsTypesModule.AgentEvent[] = [];
    const generation = now.live.generation;
    const before = was.live.generation;
    if (generation?.retry !== undefined && before?.retry === undefined) {
      const { at, error } = generation.retry;
      events.push({
        at,
        attempt: generation.attempt,
        errorMessage: error,
        type: "auto_retry_start",
      });
    }
    if (before?.retry !== undefined && generation?.retry === undefined)
      events.push({ attempt: before.attempt, type: "auto_retry_end" });
    if (
      generation?.deferred !== undefined &&
      generation.deferred.pollAt !== before?.deferred?.pollAt
    )
      events.push({ pollAt: generation.deferred.pollAt, type: "deferred_poll" });
    return events;
  },
);

const eventsStream = {
  partials,
  retryEvents,
  streamEvents,
};

export default eventsStream;
