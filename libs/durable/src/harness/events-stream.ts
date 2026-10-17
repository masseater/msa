import type { AssistantMessage } from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import { Function } from "effect";

import { messageChanges } from "./events-messages.ts";
import type { Parts } from "./events-snapshot.ts";
import type { AgentEvent } from "./events-types.ts";
import type { Dual2 } from "./types.ts";

export type Generations = {
  readonly partialBefore: AssistantMessage | undefined;
  readonly partial: AssistantMessage | undefined;
};

export const partials: Dual2<Parts, Parts, Generations> = Function.dual(
  2,
  (was: Parts, now: Parts): Generations => ({
    partialBefore: was.live.generation?.message as AssistantMessage | undefined,
    partial: now.live.generation?.message as AssistantMessage | undefined,
  }),
);

export const streamEvents: Dual2<Generations, readonly Op[], AgentEvent[]> = Function.dual(
  2,
  (generations: Generations, viewOps: readonly Op[]): AgentEvent[] => {
    const { partial, partialBefore } = generations;
    if (partial === undefined) return [];
    if (partialBefore === undefined) return [{ type: "message_start", message: partial }];
    if (partial === partialBefore) return [];
    return [
      {
        type: "message_update",
        usage: partial.usage,
        changes: messageChanges(viewOps, partial),
      },
    ];
  },
);

export const retryEvents: Dual2<Parts, Parts, AgentEvent[]> = Function.dual(
  2,
  (was: Parts, now: Parts): AgentEvent[] => {
    const events: AgentEvent[] = [];
    const generation = now.live.generation;
    const before = was.live.generation;
    if (generation?.retry !== undefined && before?.retry === undefined) {
      const { at, error } = generation.retry;
      events.push({
        type: "auto_retry_start",
        attempt: generation.attempt,
        at,
        errorMessage: error,
      });
    }
    if (before?.retry !== undefined && generation?.retry === undefined)
      events.push({ type: "auto_retry_end", attempt: before.attempt });
    if (
      generation?.deferred !== undefined &&
      generation.deferred.pollAt !== before?.deferred?.pollAt
    )
      events.push({ type: "deferred_poll", pollAt: generation.deferred.pollAt });
    return events;
  },
);
