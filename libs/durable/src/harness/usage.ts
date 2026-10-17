import type { Usage } from "@msa/ai";
import { copyJson, type Draft, type JsonRepresentation } from "@msa/chord";
import { Effect, Function } from "effect";

import { defineDoc } from "../documents.ts";
import type { ConversationId, Dual2, Dual5, Tx } from "./types.ts";

export type UsageState = {
  models: Record<string, JsonRepresentation<Usage>>;
  tools: Record<string, JsonRepresentation<Usage>>;
};

export const UsageDoc = defineDoc<UsageState>({
  kind: "msa.usage",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ models: {}, tools: {} }),
  checkpointWhen: () => true,
});

export const recordUsage: Dual5<
  Tx,
  ConversationId,
  keyof UsageState,
  string,
  Usage,
  Effect.Effect<void>
> = Function.dual(
  5,
  Effect.fnUntraced(function* (
    tx: Tx,
    conversationId: ConversationId,
    bucket: keyof UsageState,
    key: string,
    usage: Usage,
  ) {
    const totals = (yield* Effect.promise(() => tx.doc(UsageDoc, conversationId)))[bucket];
    const total = Object.hasOwn(totals, key) ? totals[key] : undefined;
    if (total === undefined)
      totals[key] = copyJson(usage, { omitUndefinedProperties: true }) as JsonRepresentation<Usage>;
    else addUsage(total, usage);
  }),
);

export const addUsage: Dual2<Draft<Usage> | Usage, Usage, void> = Function.dual(
  2,
  (total: Draft<Usage> | Usage, usage: Usage): void => {
    total.input += usage.input;
    total.output += usage.output;
    total.cacheRead += usage.cacheRead;
    total.cacheWrite += usage.cacheWrite;
    total.totalTokens += usage.totalTokens;
    if (usage.cacheWrite1h !== undefined)
      total.cacheWrite1h = (total.cacheWrite1h ?? 0) + usage.cacheWrite1h;
    if (usage.reasoning !== undefined) total.reasoning = (total.reasoning ?? 0) + usage.reasoning;
    total.cost.input += usage.cost.input;
    total.cost.output += usage.cost.output;
    total.cost.cacheRead += usage.cost.cacheRead;
    total.cost.cacheWrite += usage.cost.cacheWrite;
    total.cost.total += usage.cost.total;
  },
);

export const addUsageState: Dual2<UsageState, Readonly<UsageState>, void> = Function.dual(
  2,
  (sum: UsageState, state: Readonly<UsageState>): void => {
    for (const bucket of ["models", "tools"] as const) {
      for (const [key, usage] of Object.entries(state[bucket])) {
        const total = Object.hasOwn(sum[bucket], key) ? sum[bucket][key] : undefined;
        if (total === undefined)
          Object.defineProperty(sum[bucket], key, {
            value: structuredClone(usage),
            enumerable: true,
            writable: true,
          });
        else addUsage(total, usage);
      }
    }
  },
);
