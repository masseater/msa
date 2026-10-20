import type { Context } from "@msa/chord";
import {
  type ConversationId,
  type DocumentState,
  type DocumentWatch,
  type EntryId,
  type EntryRecord,
  ROOT_CONVERSATION_ID,
  type Session,
  type TaskId,
  type Tx,
  type TypedEntry,
  type TypedEntryDraft,
  defineDoc,
  defineEntry,
} from "@msa/durable";
import { createSession } from "@msa/durable/session";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionDefinitionsSupport from "./session-definitions-support.ts";
import sessionSupport from "./session-support.ts";
import type typeSupportTypes from "./type-support.ts";

const { awaited } = effectSupport;
const { context } = sessionSupport;

type State = ReturnType<typeof initial>;

const {
  ConversationFamily,
  checkRejectedOverloads,
  checkTxOverloads,
  initial,
  taskId: ownerTaskId,
  LatestDoc,
  RewindableDoc,
  SessionDoc,
  SessionFamily,
  TaskDoc,
  TaskFamily,
} = sessionDefinitionsSupport;

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
    typeSupportTypes.CallableWith<AsOf, [typeof LatestDoc, ConversationId, EntryId, Context]>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.CallableWith<AsOf, [typeof SessionDoc, ConversationId, EntryId, Context]>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.CallableWith<AsOf, [typeof TaskDoc, TaskId, EntryId, Context]>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.CallableWith<AsOf, [typeof RewindableDoc, ConversationId, EntryId, Context]>
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
    typeSupportTypes.CallableWith<
      typeof session.watchDoc,
      [typeof SessionDoc, ConversationId, Context]
    >
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
        typeSupportTypes.CallableWith<AppendNote, [typeof Note, ConversationId, {}]>
      >().toEqualTypeOf<false>();
      expectTypeOf<
        typeSupportTypes.CallableWith<
          AppendNote,
          [typeof Note, ConversationId, { data: { text: 1 } }]
        >
      >().toEqualTypeOf<false>();
      expectTypeOf<
        typeSupportTypes.LiteralFits<
          { kind: "t.note"; data: { text: "x" } },
          TypedEntryDraft<{ text: string }>
        >
      >().toEqualTypeOf<false>();
      expectTypeOf<
        typeSupportTypes.LiteralFits<{ data: { text: "x" } }, TypedEntryDraft<{ text: string }>>
      >().toEqualTypeOf<true>();
      expectTypeOf<
        typeSupportTypes.CallableWith<
          typeof tx.appendEntry<never>,
          [typeof Marker, ConversationId, { data: 1 }]
        >
      >().toEqualTypeOf<false>();
    }),
  );
}

const typesEveryOwner = Effect.gen(function* () {
  const session: Session = createSession(new MemoryStorage());
  expect([checkTxOverloads, checkRejectedOverloads]).toEqual([
    expect.any(Function),
    expect.any(Function),
  ]);

  expectTypeOf(yield* awaited(session.snapshot(SessionDoc, context))).toEqualTypeOf<
    Readonly<State> | undefined
  >();
  expectTypeOf(
    yield* awaited(session.snapshot(LatestDoc, ROOT_CONVERSATION_ID, context)),
  ).toEqualTypeOf<Readonly<State> | undefined>();
  expectTypeOf(yield* awaited(session.snapshot(TaskDoc, ownerTaskId, context))).toEqualTypeOf<
    Readonly<State> | undefined
  >();
  expectTypeOf(yield* awaited(session.snapshot(SessionFamily, "k", context))).toEqualTypeOf<
    Readonly<State> | undefined
  >();
  expectTypeOf(
    yield* awaited(session.snapshot(ConversationFamily, ROOT_CONVERSATION_ID, "k", context)),
  ).toEqualTypeOf<Readonly<State> | undefined>();
  expectTypeOf(
    yield* awaited(session.snapshot(TaskFamily, ownerTaskId, "k", context)),
  ).toEqualTypeOf<Readonly<State> | undefined>();
  expectTypeOf<
    typeSupportTypes.CallableWith<
      typeof session.snapshot,
      [typeof SessionFamily, string, number, Context]
    >
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
    expect(() => defineDoc<State>({ initial, kind: "k", scope: "session", version: 0 })).toThrow(
      "positive integer",
    );
    expect(() => defineDoc<State>({ initial, kind: "k", scope: "session", version: 1.5 })).toThrow(
      "positive integer",
    );
    expect(
      defineDoc<State>({ initial, kind: "", scope: "session", version: 1 }).definition.kind,
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
