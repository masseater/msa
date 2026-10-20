import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import ids from "../ids.ts";
import type sessionTypes from "../session/session.types.ts";
import bridge from "./bridge.ts";
import contextFreeze from "./context-freeze.ts";
import contextOrder from "./context-order.ts";
import contextRange from "./context-range.ts";
import type contextRangeTypes from "./context-range.types.ts";
import type typesModule from "./types.types.ts";

const { deriveRange, emptyView, extendRange, rangeQuery, scanRange, selectActive } = contextRange;
const { freezeJson } = contextFreeze;
const { idFromNumber } = ids;
const { toPromise } = bridge;

const captureContextBounds: typesModule.Dual4<
  typesModule.Storage,
  typesModule.ConversationId,
  chordTypes.Context,
  typesModule.EntryId | undefined,
  Effect.Effect<contextRangeTypes.ContextBounds | undefined>
> = Function.dual(
  4,
  Effect.fnUntraced(function* (
    storage: typesModule.Storage,
    conversationId: typesModule.ConversationId,
    context: chordTypes.Context,
    at: typesModule.EntryId | undefined,
  ) {
    let tail: typesModule.EntryId;
    if (at === undefined) {
      const page = yield* Effect.promise(() =>
        storage.scanEntries({ conversationId }, 1, undefined, context),
      );
      const latest = page.items[0]?.id;
      if (latest === undefined) return undefined;
      tail = latest;
    } else {
      const entry = yield* Effect.promise(() => storage.entry(conversationId, at, context));
      if (entry === undefined)
        return yield* Effect.die(
          new Error(`Entry ${at} is not visible from conversation ${conversationId}`),
        );
      tail = at;
    }
    const head = yield* Effect.promise(() =>
      storage.findLatestHeadMarker(conversationId, tail, context),
    );
    return { head, tail };
  }),
);

const rangeFrom = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  conversationId: typesModule.ConversationId,
  bounds: contextRangeTypes.ContextBounds,
  state: {
    readonly previous: contextRangeTypes.ContextRange | undefined;
    readonly context: chordTypes.Context;
  },
) {
  const { previous, context } = state;
  if (previous === undefined || previous.bounds.head?.id !== bounds.head?.id) {
    const entries = yield* scanRange(storage, conversationId, rangeQuery(bounds), context);
    return deriveRange(bounds, freezeJson(entries));
  }
  if (bounds.tail === previous.bounds.tail) return previous;
  if (bounds.tail < previous.bounds.tail)
    return deriveRange(
      bounds,
      previous.entries.filter((entry) => entry.id <= bounds.tail),
    );
  const minEntryId = idFromNumber<typesModule.EntryId>(previous.bounds.tail + 1);
  const added = yield* scanRange(
    storage,
    conversationId,
    { maxEntryId: bounds.tail, minEntryId },
    context,
  );
  return extendRange(previous, bounds, freezeJson(added));
});

const readContextFrom: {
  (
    storage: typesModule.Storage,
    conversationId: typesModule.ConversationId,
    context: chordTypes.Context,
    at: typesModule.EntryId | undefined,
    previous: contextRangeTypes.ContextRange | undefined,
  ): (session: sessionTypes.SessionImpl) => Effect.Effect<{
    readonly view: typesModule.ContextView;
    readonly range: contextRangeTypes.ContextRange | undefined;
  }>;
  (
    session: sessionTypes.SessionImpl,
    storage: typesModule.Storage,
    conversationId: typesModule.ConversationId,
    context: chordTypes.Context,
    at: typesModule.EntryId | undefined,
    previous: contextRangeTypes.ContextRange | undefined,
  ): Effect.Effect<{
    readonly view: typesModule.ContextView;
    readonly range: contextRangeTypes.ContextRange | undefined;
  }>;
} = Function.dual(
  6,
  Effect.fnUntraced(function* (
    session: sessionTypes.SessionImpl,
    storage: typesModule.Storage,
    conversationId: typesModule.ConversationId,
    context: chordTypes.Context,
    at: typesModule.EntryId | undefined,
    previous: contextRangeTypes.ContextRange | undefined,
  ) {
    const capture = yield* toPromise(() =>
      captureContextBounds(storage, conversationId, context, at),
    );
    const bounds = yield* Effect.promise(() => session.readOnLine(capture));
    if (bounds === undefined) return { range: undefined, view: emptyView() };
    freezeJson(bounds.head);
    const range = yield* rangeFrom(storage, conversationId, bounds, { context, previous });
    const { view } = range;
    return {
      range,
      view: {
        ...view,
        contributions: [...view.contributions],
        entries: [...view.entries],
        messages: [...view.messages],
      },
    };
  }),
);

const readContext: {
  (
    storage: typesModule.Storage,
    conversationId: typesModule.ConversationId,
    context: chordTypes.Context,
    at?: typesModule.EntryId,
  ): (session: sessionTypes.SessionImpl) => Effect.Effect<typesModule.ContextView>;
  (
    session: sessionTypes.SessionImpl,
    storage: typesModule.Storage,
    conversationId: typesModule.ConversationId,
    context: chordTypes.Context,
    at?: typesModule.EntryId,
  ): Effect.Effect<typesModule.ContextView>;
} = Function.dual(
  (args: IArguments) => args.length >= 4 && typeof args[1] !== "number",
  Effect.fnUntraced(function* (
    session: sessionTypes.SessionImpl,
    storage: typesModule.Storage,
    conversationId: typesModule.ConversationId,
    context: chordTypes.Context,
    at?: typesModule.EntryId,
  ) {
    const capture = yield* toPromise(() =>
      captureContextBounds(storage, conversationId, context, at),
    );
    const bounds = yield* Effect.promise(() => session.readOnLine(capture));
    return yield* deriveContext(storage, conversationId, bounds, context);
  }),
);

const deriveContext: typesModule.Dual4<
  typesModule.Storage,
  typesModule.ConversationId,
  contextRangeTypes.ContextBounds | undefined,
  chordTypes.Context,
  Effect.Effect<typesModule.ContextView>
> = Function.dual(
  4,
  Effect.fnUntraced(function* (
    storage: typesModule.Storage,
    conversationId: typesModule.ConversationId,
    bounds: contextRangeTypes.ContextBounds | undefined,
    context: chordTypes.Context,
  ) {
    if (bounds === undefined) return emptyView();
    const entries = yield* scanRange(storage, conversationId, rangeQuery(bounds), context);
    return deriveRange(bounds, entries).view;
  }),
);

const activeEntries: typesModule.Dual4<
  typesModule.Storage,
  typesModule.ConversationId,
  contextRangeTypes.ContextBounds | undefined,
  chordTypes.Context,
  Effect.Effect<readonly typesModule.EntryRecord[]>
> = Function.dual(
  4,
  Effect.fnUntraced(function* (
    storage: typesModule.Storage,
    conversationId: typesModule.ConversationId,
    bounds: contextRangeTypes.ContextBounds | undefined,
    context: chordTypes.Context,
  ) {
    if (bounds === undefined) return [];
    const entries = yield* scanRange(storage, conversationId, rangeQuery(bounds), context);
    return selectActive(bounds.head, entries);
  }),
);

const contextModule = {
  activeEntries,
  captureContextBounds,
  deriveContext,
  orderToolResults: contextOrder.orderToolResults,
  readContext,
  readContextFrom,
};

export default contextModule;
