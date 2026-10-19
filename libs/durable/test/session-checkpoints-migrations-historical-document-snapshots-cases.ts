import { defineDoc } from "@msa/durable";

export type V1 = { name: string };

export type V2 = { names: string[] };

export const V1Doc = defineDoc<V1>({
  kind: "cache.versioned",
  version: 1,
  scope: "session",
  initial: () => ({ name: "first" }),
});

export const V2Doc = defineDoc<V2>({
  kind: "cache.versioned",
  version: 2,
  scope: "session",
  initial: () => ({ names: [] }),
  migrate: (value) => ({ names: [value["name"] as string] }),
});
