import { uuidv7 } from "@msa/ai/utils/uuid";
import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { defineDoc } from "../documents.ts";
import type { TaskRuntime } from "./types.ts";

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

const createSessionId = <I, S, R, H extends object>(
  runtime: TaskRuntime<I, S, R, H>,
  context: Context,
) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<never>();
    let created: string | undefined;
    yield* Effect.promise(() =>
      runtime.commit(
        (tx) =>
          Effect.runPromiseWith(services)(
            Effect.gen(function* () {
              created = (yield* Effect.promise(() => tx.doc(ProviderDoc, runtime.conversationId)))
                .sessionId;
              return undefined;
            }),
          ),
        context,
      ),
    );
    return created;
  });

export const ensureProviderSessionId: {
  (
    context: Context,
  ): <I, S, R, H extends object>(runtime: TaskRuntime<I, S, R, H>) => Effect.Effect<string>;
  <I, S, R, H extends object>(
    runtime: TaskRuntime<I, S, R, H>,
    context: Context,
  ): Effect.Effect<string>;
} = Function.dual(
  2,
  Effect.fnUntraced(function* <I, S, R, H extends object>(
    runtime: TaskRuntime<I, S, R, H>,
    context: Context,
  ) {
    const existing = yield* Effect.promise(() =>
      runtime.snapshot(ProviderDoc, runtime.conversationId, context),
    );
    if (existing !== undefined) return existing.sessionId;
    const created = yield* createSessionId(runtime, context);
    if (created === undefined)
      throw new Error(`Conversation ${runtime.conversationId} has no provider session ID`);
    return created;
  }),
);
