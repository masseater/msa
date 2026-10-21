import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import effectSupport from "./effect-support.ts";
import specUsageExtensions from "./spec-usage-extensions.ts";
import type specUsageNamesTypes from "./spec-usage-names.ts";
import type specUsageSequencesTypes from "./spec-usage-sequences.types.ts";

const { LiveDoc, configure } = durable;

const { awaited } = effectSupport;
const { followTask } = specUsageExtensions;

const spawnSubagent =
  (
    { Anchor, name }: specUsageNamesTypes.SpecNames,
    SubagentTools: specUsageSequencesTypes.SpecExtensions["SubagentTools"],
  ) =>
  (tx: durableTypes.Tx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const anchor = yield* awaited(
          tx.createTask(Anchor, null, {
            background: true,
            ownership: { kind: "conversation" },
          }),
        );
        const child = yield* awaited(
          tx.createConversation({ ownership: { kind: "task", taskId: anchor } }),
        );
        yield* awaited(
          configure(tx, child.id, {
            extensions: { remove: [SubagentTools] },
            instructions: `You are the subagent "${name}". Answer the main agent's requests.`,
          }),
        );
      }),
    );

const tableRulesSequence =
  (
    { session, conversationId, message, context }: specUsageNamesTypes.SpecNames,
    Follow: ReturnType<typeof followTask>,
  ) =>
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* awaited(
          session.commit(
            (tx) =>
              runPromise(
                Effect.gen(function* () {
                  const conversation = yield* awaited(tx.conversation(conversationId));
                  const live = yield* awaited(tx.doc(LiveDoc, conversationId));

                  yield* awaited(tx.appendEntry(conversationId, message));
                  delete live.generation;
                  yield* awaited(
                    tx.createTask(
                      Follow,
                      {},
                      { conversationId, ownership: { kind: "conversation" } },
                    ),
                  );
                  void conversation;
                }),
              ),
            context,
          ),
        );
      }),
    );

function taskSequencesImpl(
  names: specUsageNamesTypes.SpecNames,
  SubagentTools: specUsageSequencesTypes.SpecExtensions["SubagentTools"],
  Follow: ReturnType<typeof followTask>,
) {
  const { session, conversationId, context } = names;
  return {
    revokedDraft: () =>
      session
        .commit((tx) => tx.doc(LiveDoc, conversationId).then((escaped) => escaped), context)
        .then((escaped) => {
          escaped!.generation = { attempt: 1 };
          return undefined;
        }),
    spawn: spawnSubagent(names, SubagentTools),
    tableRules: tableRulesSequence(names, Follow),
  };
}

const taskSequences: {
  (
    SubagentTools: specUsageSequencesTypes.SpecExtensions["SubagentTools"],
    Follow: ReturnType<typeof followTask>,
  ): (arg0: specUsageNamesTypes.SpecNames) => ReturnType<typeof taskSequencesImpl>;
  (
    arg0: specUsageNamesTypes.SpecNames,
    SubagentTools: specUsageSequencesTypes.SpecExtensions["SubagentTools"],
    Follow: ReturnType<typeof followTask>,
  ): ReturnType<typeof taskSequencesImpl>;
} = dual(3, taskSequencesImpl);

export default taskSequences;
