import type { Usage } from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";
import json from "@msa/chord/json";
import { Effect, Function } from "effect";

import documents from "../documents.ts";
import type typesModule from "./types.types.ts";
import type usageTypes from "./usage.types.ts";

const { copyJson } = json;

const { defineDoc } = documents;

const UsageDoc = defineDoc<usageTypes.UsageState>({
  checkpointWhen: () => true,
  fork: "initial",
  history: "latest",
  initial: () => ({ models: {}, tools: {} }),
  kind: "msa.usage",
  scope: "conversation",
  version: 1,
});

const recordUsage: typesModule.Dual5<
  typesModule.Tx,
  typesModule.ConversationId,
  keyof usageTypes.UsageState,
  string,
  Usage,
  Effect.Effect<void>
> = Function.dual(
  5,
  Effect.fnUntraced(function* (
    tx: typesModule.Tx,
    conversationId: typesModule.ConversationId,
    bucket: keyof usageTypes.UsageState,
    key: string,
    usage: Usage,
  ) {
    const totals = (yield* Effect.promise(() => tx.doc(UsageDoc, conversationId)))[bucket];
    const total = Object.hasOwn(totals, key) ? totals[key] : undefined;
    if (total === undefined)
      totals[key] = copyJson(usage, {
        omitUndefinedProperties: true,
      }) as chordTypes.JsonRepresentation<Usage>;
    else addUsage(total, usage);
  }),
);

const addUsage: typesModule.Dual2<chordTypes.Draft<Usage> | Usage, Usage, void> = Function.dual(
  2,
  (total: chordTypes.Draft<Usage> | Usage, usage: Usage): void => {
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

const addUsageState: typesModule.Dual2<
  usageTypes.UsageState,
  Readonly<usageTypes.UsageState>,
  void
> = Function.dual(2, (sum: usageTypes.UsageState, state: Readonly<usageTypes.UsageState>): void => {
  for (const bucket of ["models", "tools"] as const) {
    for (const [key, usage] of Object.entries(state[bucket])) {
      const total = Object.hasOwn(sum[bucket], key) ? sum[bucket][key] : undefined;
      if (total === undefined)
        Object.defineProperty(sum[bucket], key, {
          enumerable: true,
          value: structuredClone(usage),
          writable: true,
        });
      else addUsage(total, usage);
    }
  }
});

const usageModule = {
  UsageDoc,
  addUsage,
  addUsageState,
  recordUsage,
};

export default usageModule;
