import type { Context, Draft } from "@msa/chord";
import {
  type ConversationId,
  type DocumentState,
  type DocumentWatch,
  defineDoc,
  defineDocFamily,
  defineEntry,
  type EntryId,
  type EntryRecord,
  ROOT_CONVERSATION_ID,
  type Session,
  type TaskId,
  type Tx,
  type TypedEntry,
  type TypedEntryDraft,
} from "@msa/durable";
import { createSession } from "@msa/durable/session";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";
import type { CallableWith, LiteralFits } from "./type-support.ts";

type State = { value: number };
const initial = (): State => ({ value: 0 });

const SessionDoc = defineDoc<State>({ kind: "t.session", version: 1, scope: "session", initial });
const LatestDoc = defineDoc<State>({
  kind: "t.latest",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial,
});
const RewindableDoc = defineDoc<State>({
  kind: "t.rewindable",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial,
});
const TaskDoc = defineDoc<State>({ kind: "t.task", version: 1, scope: "task", initial });
const SessionFamily = defineDocFamily<State, number>({
  kind: "t.session-family",
  version: 1,
  family: true,
  scope: "session",
  initial: (seed) => ({ value: seed }),
});
const ConversationFamily = defineDocFamily<State, number>({
  kind: "t.conversation-family",
  version: 1,
  family: true,
  scope: "conversation",
  history: "rewindable",
  fork: "initial",
  initial: (seed) => ({ value: seed }),
});
const TaskFamily = defineDocFamily<State, number>({
  kind: "t.task-family",
  version: 1,
  family: true,
  scope: "task",
  initial: (seed) => ({ value: seed }),
});

function checkTxOverloads(tx: Tx, conversationId: ConversationId, taskId: TaskId): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      expectTypeOf(yield* awaited(tx.doc(SessionDoc))).toEqualTypeOf<Draft<State>>();
      expectTypeOf(yield* awaited(tx.doc(LatestDoc, conversationId))).toEqualTypeOf<Draft<State>>();
      expectTypeOf(yield* awaited(tx.doc(RewindableDoc, conversationId))).toEqualTypeOf<
        Draft<State>
      >();
      expectTypeOf(yield* awaited(tx.doc(TaskDoc, taskId))).toEqualTypeOf<Draft<State>>();
      expectTypeOf(yield* awaited(tx.doc(SessionFamily, "k", 1))).toEqualTypeOf<Draft<State>>();
      expectTypeOf(
        yield* awaited(tx.doc(ConversationFamily, conversationId, "k", 1)),
      ).toEqualTypeOf<Draft<State>>();
      expectTypeOf(yield* awaited(tx.doc(TaskFamily, taskId, "k", 1))).toEqualTypeOf<
        Draft<State>
      >();
      yield* awaited(tx.retireDoc(SessionDoc));
      yield* awaited(tx.retireDoc(LatestDoc, conversationId));
      yield* awaited(tx.retireDoc(TaskDoc, taskId));
      yield* awaited(tx.retireDoc(SessionFamily, "k"));
      yield* awaited(tx.retireDoc(ConversationFamily, conversationId, "k"));
      yield* awaited(tx.retireDoc(TaskFamily, taskId, "k"));

      expectTypeOf<
        CallableWith<typeof tx.doc, [typeof SessionDoc, ConversationId]>
      >().toEqualTypeOf<false>();
      expectTypeOf<CallableWith<typeof tx.doc, [typeof LatestDoc]>>().toEqualTypeOf<false>();
      expectTypeOf<
        CallableWith<typeof tx.doc, [typeof SessionFamily, string]>
      >().toEqualTypeOf<false>();
      expectTypeOf<
        CallableWith<typeof tx.doc<State, number>, [typeof SessionFamily, string, "seed"]>
      >().toEqualTypeOf<false>();
      expectTypeOf<
        CallableWith<typeof tx.doc<State, number>, [typeof SessionFamily, string, number]>
      >().toEqualTypeOf<true>();
      expectTypeOf<
        CallableWith<typeof tx.retireDoc, [typeof TaskFamily, TaskId, string, number]>
      >().toEqualTypeOf<false>();
    }),
  );
}

const Note = defineEntry<{ text: string }>("t.note");
const Marker = defineEntry("t.marker");
type Rewound = Promise<Readonly<State> | undefined>;
type StateOf = Promise<DocumentState<State> | undefined>;
type WatchOf = Promise<DocumentWatch<State> | undefined>;

function checkHistoricalReads(
  session: Session,
  conversationId: ConversationId,
  taskId: TaskId,
  at: EntryId,
): void {
  expectTypeOf(
    session.snapshotAsOf(RewindableDoc, conversationId, at, context),
  ).toEqualTypeOf<Rewound>();
  expectTypeOf(
    session.snapshotAsOf(ConversationFamily, conversationId, "k", at, context),
  ).toEqualTypeOf<Rewound>();
  type AsOf = typeof session.snapshotAsOf;
  expectTypeOf<
    CallableWith<AsOf, [typeof LatestDoc, ConversationId, EntryId, Context]>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    CallableWith<AsOf, [typeof SessionDoc, ConversationId, EntryId, Context]>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    CallableWith<AsOf, [typeof TaskDoc, TaskId, EntryId, Context]>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    CallableWith<AsOf, [typeof RewindableDoc, ConversationId, EntryId, Context]>
  >().toEqualTypeOf<true>();
  void [conversationId, taskId, at];
}

function checkStatesAndWatches(
  session: Session,
  conversationId: ConversationId,
  taskId: TaskId,
): void {
  expectTypeOf(session.documentState(SessionDoc, context)).toEqualTypeOf<StateOf>();
  expectTypeOf(session.documentState(LatestDoc, conversationId, context)).toEqualTypeOf<StateOf>();
  expectTypeOf(session.documentState(TaskDoc, taskId, context)).toEqualTypeOf<StateOf>();
  expectTypeOf(session.documentState(SessionFamily, "k", context)).toEqualTypeOf<StateOf>();
  expectTypeOf(
    session.documentState(ConversationFamily, conversationId, "k", context),
  ).toEqualTypeOf<StateOf>();
  expectTypeOf(session.documentState(TaskFamily, taskId, "k", context)).toEqualTypeOf<StateOf>();
  expectTypeOf(session.watchDoc(SessionDoc, context)).toEqualTypeOf<WatchOf>();
  expectTypeOf(session.watchDoc(LatestDoc, conversationId, context)).toEqualTypeOf<WatchOf>();
  expectTypeOf(session.watchDoc(TaskDoc, taskId, context)).toEqualTypeOf<WatchOf>();
  expectTypeOf(session.watchDoc(SessionFamily, "k", context)).toEqualTypeOf<WatchOf>();
  expectTypeOf(
    session.watchDoc(ConversationFamily, conversationId, "k", context),
  ).toEqualTypeOf<WatchOf>();
  expectTypeOf(session.watchDoc(TaskFamily, taskId, "k", context)).toEqualTypeOf<WatchOf>();
  expectTypeOf<
    CallableWith<typeof session.watchDoc, [typeof SessionDoc, ConversationId, Context]>
  >().toEqualTypeOf<false>();
}

function checkTypedEntries(tx: Tx, conversationId: ConversationId, at: EntryId): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      expectTypeOf(yield* awaited(tx.entry(at))).toEqualTypeOf<EntryRecord | undefined>();
      expectTypeOf(yield* awaited(tx.entry(Note, at))).toEqualTypeOf<
        TypedEntry<{ text: string }> | undefined
      >();
      expectTypeOf(
        yield* awaited(tx.appendEntry(conversationId, { kind: "t.raw" })),
      ).toEqualTypeOf<EntryRecord>();
      const note = yield* awaited(tx.appendEntry(Note, conversationId, { data: { text: "x" } }));
      expectTypeOf(note).toEqualTypeOf<TypedEntry<{ text: string }>>();
      expectTypeOf(note.data.text).toEqualTypeOf<string>();
      expectTypeOf(yield* awaited(tx.appendEntry(Marker, conversationId, {}))).toEqualTypeOf<
        TypedEntry<never>
      >();
      type AppendNote = typeof tx.appendEntry<{ text: string }>;
      expectTypeOf<
        CallableWith<AppendNote, [typeof Note, ConversationId, {}]>
      >().toEqualTypeOf<false>();
      expectTypeOf<
        CallableWith<AppendNote, [typeof Note, ConversationId, { data: { text: 1 } }]>
      >().toEqualTypeOf<false>();
      expectTypeOf<
        LiteralFits<{ kind: "t.note"; data: { text: "x" } }, TypedEntryDraft<{ text: string }>>
      >().toEqualTypeOf<false>();
      expectTypeOf<
        LiteralFits<{ data: { text: "x" } }, TypedEntryDraft<{ text: string }>>
      >().toEqualTypeOf<true>();
      expectTypeOf<
        CallableWith<typeof tx.appendEntry<never>, [typeof Marker, ConversationId, { data: 1 }]>
      >().toEqualTypeOf<false>();
    }),
  );
}

const typesEveryOwner = Effect.gen(function* () {
  const session: Session = createSession(new MemoryStorage());
  expect(checkTxOverloads).toBeTypeOf("function");

  expectTypeOf(yield* awaited(session.snapshot(SessionDoc, context))).toEqualTypeOf<
    Readonly<State> | undefined
  >();
  const taskId = idFromNumber<TaskId>(1);
  expectTypeOf(
    yield* awaited(session.snapshot(LatestDoc, ROOT_CONVERSATION_ID, context)),
  ).toEqualTypeOf<Readonly<State> | undefined>();
  expectTypeOf(yield* awaited(session.snapshot(TaskDoc, taskId, context))).toEqualTypeOf<
    Readonly<State> | undefined
  >();
  expectTypeOf(yield* awaited(session.snapshot(SessionFamily, "k", context))).toEqualTypeOf<
    Readonly<State> | undefined
  >();
  expectTypeOf(
    yield* awaited(session.snapshot(ConversationFamily, ROOT_CONVERSATION_ID, "k", context)),
  ).toEqualTypeOf<Readonly<State> | undefined>();
  expectTypeOf(yield* awaited(session.snapshot(TaskFamily, taskId, "k", context))).toEqualTypeOf<
    Readonly<State> | undefined
  >();
  expectTypeOf<
    CallableWith<typeof session.snapshot, [typeof SessionFamily, string, number, Context]>
  >().toEqualTypeOf<false>();
  yield* Effect.exit(
    awaited(
      Reflect.apply(session.snapshot, session, [
        SessionFamily,
        "k",
        1,
        context,
      ]) as Promise<unknown>,
    ),
  );
  yield* awaited(session.close(context));
});

describe("document definitions", () => {
  it("validates persisted version semantics", () => {
    expect(() => defineDoc<State>({ kind: "k", version: 0, scope: "session", initial })).toThrow(
      "positive integer",
    );
    expect(() => defineDoc<State>({ kind: "k", version: 1.5, scope: "session", initial })).toThrow(
      "positive integer",
    );
    expect(
      defineDoc<State>({ kind: "", version: 1, scope: "session", initial }).definition.kind,
    ).toBe("");
    expect(SessionDoc.definition.kind).toBe("t.session");
  });

  it("types every owner, key, and seed overload", () => Effect.runPromise(typesEveryOwner));

  it("types historical reads, states, watches, and typed entries", () => {
    expect(checkHistoricalReads).toBeTypeOf("function");
    expect(checkStatesAndWatches).toBeTypeOf("function");
    expect(checkTypedEntries).toBeTypeOf("function");
  });
});
