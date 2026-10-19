import { configure, LiveDoc, type Tx } from "@msa/durable";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { awaited } from "./effect-support.ts";
import type { followTask } from "./spec-usage-extensions.ts";
import type { SpecNames } from "./spec-usage-names.ts";
import type { SpecExtensions } from "./spec-usage-sequences.ts";

const spawnSubagent =
  ({ Anchor, name }: SpecNames, SubagentTools: SpecExtensions["SubagentTools"]) =>
  (tx: Tx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const anchor = yield* awaited(
          tx.createTask(Anchor, null, {
            ownership: { kind: "conversation" },
            background: true,
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
    { session, conversationId, message, context }: SpecNames,
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
                      { ownership: { kind: "conversation" }, conversationId },
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
  names: SpecNames,
  SubagentTools: SpecExtensions["SubagentTools"],
  Follow: ReturnType<typeof followTask>,
) {
  const { session, conversationId, context } = names;
  return {
    spawn: spawnSubagent(names, SubagentTools),
    tableRules: tableRulesSequence(names, Follow),
    revokedDraft: () =>
      session
        .commit((tx) => tx.doc(LiveDoc, conversationId).then((escaped) => escaped), context)
        .then((escaped) => {
          escaped!.generation = { attempt: 1 };
          return undefined;
        }),
  };
}

export const taskSequences: {
  (
    SubagentTools: SpecExtensions["SubagentTools"],
    Follow: ReturnType<typeof followTask>,
  ): (arg0: SpecNames) => ReturnType<typeof taskSequencesImpl>;
  (
    arg0: SpecNames,
    SubagentTools: SpecExtensions["SubagentTools"],
    Follow: ReturnType<typeof followTask>,
  ): ReturnType<typeof taskSequencesImpl>;
} = dual(3, taskSequencesImpl);
