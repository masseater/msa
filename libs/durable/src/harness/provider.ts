import { uuidv7 } from "@msa/ai/utils/uuid";
import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import documents from "../documents.ts";
import type providerTypes from "./provider.types.ts";
import type typesModule from "./types.types.ts";

const { defineDoc } = documents;

const ProviderDoc = defineDoc<providerTypes.ProviderState>({
  checkpointWhen: () => true,
  fork: "initial",
  history: "latest",
  initial: () => ({ sessionId: uuidv7() }),
  kind: "msa.provider",
  scope: "conversation",
  version: 1,
});

const createSessionId = <I, S, R, H extends object>(
  runtime: typesModule.TaskRuntime<I, S, R, H>,
  context: chordTypes.Context,
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

const ensureProviderSessionId: {
  (
    context: chordTypes.Context,
  ): <I, S, R, H extends object>(
    runtime: typesModule.TaskRuntime<I, S, R, H>,
  ) => Effect.Effect<string>;
  <I, S, R, H extends object>(
    runtime: typesModule.TaskRuntime<I, S, R, H>,
    context: chordTypes.Context,
  ): Effect.Effect<string>;
} = Function.dual(
  2,
  Effect.fnUntraced(function* <I, S, R, H extends object>(
    runtime: typesModule.TaskRuntime<I, S, R, H>,
    context: chordTypes.Context,
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

const provider = {
  ProviderDoc,
  ensureProviderSessionId,
};

export default provider;
