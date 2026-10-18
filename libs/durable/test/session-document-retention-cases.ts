import { defineDoc } from "@msa/durable";

import { type Counter } from "./session-document-retention-support.ts";

export const SessionCounterDoc = defineDoc<Counter>({
  kind: "test.retention.session-counter",
  version: 1,
  scope: "session",
  initial: () => ({ count: 0 }),
});
