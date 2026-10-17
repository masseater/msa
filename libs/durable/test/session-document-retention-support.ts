import { type ConversationId, defineDoc } from "@msa/durable";

import { SessionImpl } from "../src/session/session.ts";
import { ControlledStorage, context } from "./session-support.ts";

export type Counter = { count: number };

export const CounterDoc = defineDoc<Counter>({
  kind: "test.retention.counter",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ count: 0 }),
});

/** The default retention of this run, as the setup file set it. */
export const defaultForRun =
  process.env["MSA_DURABLE_DOCUMENT_RETENTION_MS"] === undefined
    ? 600_000
    : Number(process.env["MSA_DURABLE_DOCUMENT_RETENTION_MS"]);

// A Session with a controllable clock and retention.
export function open(retentionMs: number) {
  const clock = { now: 1_000 };
  const storage = new ControlledStorage();
  const session = new SessionImpl(
    storage,
    () => clock.now,
    () => retentionMs,
  );
  const sizes = () => session.documentCacheSizes;
  return { storage, session, clock, sizes };
}

// Let the line run what is queued on it: an eviction job, then return.
export async function settleLine(session: SessionImpl): Promise<void> {
  await session.readOnLine(async () => {});
}

export async function bump(
  session: SessionImpl,
  conversationId: ConversationId,
  by = 1,
): Promise<void> {
  await session.commit(async (tx) => {
    (await tx.doc(CounterDoc, conversationId)).count += by;
  }, context);
}
