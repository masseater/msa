import type chordTypes from "@msa/chord/index.types";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { expectTypeOf } from "vite-plus/test";

import ids from "../src/ids.ts";
import effectSupport from "./effect-support.ts";
import type typeSupportTypes from "./type-support.ts";

const { defineDoc, defineDocFamily } = durable;
const { idFromNumber } = ids;

const { awaited } = effectSupport;

type State = { value: number };

const initial = (): State => ({ value: 0 });

const SessionDoc = defineDoc<State>({ initial, kind: "t.session", scope: "session", version: 1 });
const LatestDoc = defineDoc<State>({
  fork: "current",
  history: "latest",
  initial,
  kind: "t.latest",
  scope: "conversation",
  version: 1,
});
const RewindableDoc = defineDoc<State>({
  fork: "asOf",
  history: "rewindable",
  initial,
  kind: "t.rewindable",
  scope: "conversation",
  version: 1,
});
const TaskDoc = defineDoc<State>({ initial, kind: "t.task", scope: "task", version: 1 });
const SessionFamily = defineDocFamily<State, number>({
  family: true,
  initial: (seed) => ({ value: seed }),
  kind: "t.session-family",
  scope: "session",
  version: 1,
});
const ConversationFamily = defineDocFamily<State, number>({
  family: true,
  fork: "initial",
  history: "rewindable",
  initial: (seed) => ({ value: seed }),
  kind: "t.conversation-family",
  scope: "conversation",
  version: 1,
});
const TaskFamily = defineDocFamily<State, number>({
  family: true,
  initial: (seed) => ({ value: seed }),
  kind: "t.task-family",
  scope: "task",
  version: 1,
});

function checkTxOverloads(
  tx: durableTypes.Tx,
  conversationId: durableTypes.ConversationId,
  taskId: durableTypes.TaskId,
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      expectTypeOf(yield* awaited(tx.doc(SessionDoc))).toEqualTypeOf<chordTypes.Draft<State>>();
      expectTypeOf(yield* awaited(tx.doc(LatestDoc, conversationId))).toEqualTypeOf<
        chordTypes.Draft<State>
      >();
      expectTypeOf(yield* awaited(tx.doc(RewindableDoc, conversationId))).toEqualTypeOf<
        chordTypes.Draft<State>
      >();
      expectTypeOf(yield* awaited(tx.doc(TaskDoc, taskId))).toEqualTypeOf<
        chordTypes.Draft<State>
      >();
      expectTypeOf(yield* awaited(tx.doc(SessionFamily, "k", 1))).toEqualTypeOf<
        chordTypes.Draft<State>
      >();
      expectTypeOf(
        yield* awaited(tx.doc(ConversationFamily, conversationId, "k", 1)),
      ).toEqualTypeOf<chordTypes.Draft<State>>();
      expectTypeOf(yield* awaited(tx.doc(TaskFamily, taskId, "k", 1))).toEqualTypeOf<
        chordTypes.Draft<State>
      >();
      yield* awaited(tx.retireDoc(SessionDoc));
      yield* awaited(tx.retireDoc(LatestDoc, conversationId));
      yield* awaited(tx.retireDoc(TaskDoc, taskId));
      yield* awaited(tx.retireDoc(SessionFamily, "k"));
      yield* awaited(tx.retireDoc(ConversationFamily, conversationId, "k"));
      yield* awaited(tx.retireDoc(TaskFamily, taskId, "k"));
    }),
  );
}

function checkRejectedOverloads(tx: durableTypes.Tx): void {
  expectTypeOf<
    typeSupportTypes.CallableWith<typeof tx.doc, [typeof SessionDoc, durableTypes.ConversationId]>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.CallableWith<typeof tx.doc, [typeof LatestDoc]>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.CallableWith<typeof tx.doc, [typeof SessionFamily, string]>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.CallableWith<
      typeof tx.doc<State, number>,
      [typeof SessionFamily, string, "seed"]
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.CallableWith<
      typeof tx.doc<State, number>,
      [typeof SessionFamily, string, number]
    >
  >().toEqualTypeOf<true>();
  expectTypeOf<
    typeSupportTypes.CallableWith<
      typeof tx.retireDoc,
      [typeof TaskFamily, durableTypes.TaskId, string, number]
    >
  >().toEqualTypeOf<false>();
}

const taskId = idFromNumber<durableTypes.TaskId>(1);

const sessionDefinitionsSupport = {
  ConversationFamily,
  LatestDoc,
  RewindableDoc,
  SessionDoc,
  SessionFamily,
  TaskDoc,
  TaskFamily,
  checkRejectedOverloads,
  checkTxOverloads,
  initial,
  taskId,
};

export default sessionDefinitionsSupport;
