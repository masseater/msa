import { uuidv7 } from "@msa/ai/utils/uuid";
import type { Context } from "@msa/chord";

import { defineDoc } from "../documents.ts";
import type { TaskRuntime } from "../types.ts";

export type ProviderState = {
  sessionId: string;
};

export const ProviderDoc = defineDoc<ProviderState>({
  kind: "msa.provider",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ sessionId: uuidv7() }),
  checkpointWhen: () => true,
});

export async function ensureProviderSessionId<I, S, R, H extends object>(
  runtime: TaskRuntime<I, S, R, H>,
  context: Context,
): Promise<string> {
  const existing = await runtime.snapshot(ProviderDoc, runtime.conversationId, context);
  if (existing !== undefined) return existing.sessionId;
  let created: string | undefined;
  await runtime.commit(async (tx) => {
    created = (await tx.doc(ProviderDoc, runtime.conversationId)).sessionId;
    return undefined;
  }, context);
  if (created === undefined)
    throw new Error(`Conversation ${runtime.conversationId} has no provider session ID`);
  return created;
}
