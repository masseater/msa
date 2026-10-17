import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { idFromNumber } from "../ids.ts";
import type { SessionImpl } from "../session/session.ts";
import { toPromise } from "./bridge.ts";
import { freezeJson } from "./context-freeze.ts";
import {
  type ContextBounds,
  type ContextRange,
  deriveRange,
  emptyView,
  extendRange,
  rangeQuery,
  scanRange,
  selectActive,
} from "./context-range.ts";
import type { ContextView, ConversationId, Dual4, EntryId, EntryRecord, Storage } from "./types.ts";

export type { ContextBounds, ContextRange } from "./context-range.ts";
export { orderToolResults } from "./context-order.ts";

export const captureContextBounds: Dual4<
  Storage,
  ConversationId,
  Context,
  EntryId | undefined,
  Effect.Effect<ContextBounds | undefined>
> = Function.dual(
  4,
  Effect.fn("captureContextBounds")(function* (
    storage: Storage,
    conversationId: ConversationId,
    context: Context,
    at: EntryId | undefined,
  ) {
    let tail: EntryId;
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

const rangeFrom = Effect.fn("rangeFrom")(function* (
  storage: Storage,
  conversationId: ConversationId,
  bounds: ContextBounds,
  state: { readonly previous: ContextRange | undefined; readonly context: Context },
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
  const minEntryId = idFromNumber<EntryId>(previous.bounds.tail + 1);
  const added = yield* scanRange(
    storage,
    conversationId,
    { minEntryId, maxEntryId: bounds.tail },
    context,
  );
  return extendRange(previous, bounds, freezeJson(added));
});

export const readContextFrom: {
  (
    storage: Storage,
    conversationId: ConversationId,
    context: Context,
    at: EntryId | undefined,
    previous: ContextRange | undefined,
  ): (
    session: SessionImpl,
  ) => Effect.Effect<{ readonly view: ContextView; readonly range: ContextRange | undefined }>;
  (
    session: SessionImpl,
    storage: Storage,
    conversationId: ConversationId,
    context: Context,
    at: EntryId | undefined,
    previous: ContextRange | undefined,
  ): Effect.Effect<{ readonly view: ContextView; readonly range: ContextRange | undefined }>;
} = Function.dual(
  6,
  Effect.fn("readContextFrom")(function* (
    session: SessionImpl,
    storage: Storage,
    conversationId: ConversationId,
    context: Context,
    at: EntryId | undefined,
    previous: ContextRange | undefined,
  ) {
    const capture = yield* toPromise(() =>
      captureContextBounds(storage, conversationId, context, at),
    );
    const bounds = yield* Effect.promise(() => session.readOnLine(capture));
    if (bounds === undefined) return { view: emptyView(), range: undefined };
    freezeJson(bounds.head);
    const range = yield* rangeFrom(storage, conversationId, bounds, { previous, context });
    const { view } = range;
    return {
      view: {
        ...view,
        entries: [...view.entries],
        contributions: [...view.contributions],
        messages: [...view.messages],
      },
      range,
    };
  }),
);

export const readContext: {
  (
    storage: Storage,
    conversationId: ConversationId,
    context: Context,
    at?: EntryId,
  ): (session: SessionImpl) => Effect.Effect<ContextView>;
  (
    session: SessionImpl,
    storage: Storage,
    conversationId: ConversationId,
    context: Context,
    at?: EntryId,
  ): Effect.Effect<ContextView>;
} = Function.dual(
  (args: IArguments) => args.length >= 4 && typeof args[1] !== "number",
  Effect.fn("readContext")(function* (
    session: SessionImpl,
    storage: Storage,
    conversationId: ConversationId,
    context: Context,
    at?: EntryId,
  ) {
    const capture = yield* toPromise(() =>
      captureContextBounds(storage, conversationId, context, at),
    );
    const bounds = yield* Effect.promise(() => session.readOnLine(capture));
    return yield* deriveContext(storage, conversationId, bounds, context);
  }),
);

export const deriveContext: Dual4<
  Storage,
  ConversationId,
  ContextBounds | undefined,
  Context,
  Effect.Effect<ContextView>
> = Function.dual(
  4,
  Effect.fn("deriveContext")(function* (
    storage: Storage,
    conversationId: ConversationId,
    bounds: ContextBounds | undefined,
    context: Context,
  ) {
    if (bounds === undefined) return emptyView();
    const entries = yield* scanRange(storage, conversationId, rangeQuery(bounds), context);
    return deriveRange(bounds, entries).view;
  }),
);

export const activeEntries: Dual4<
  Storage,
  ConversationId,
  ContextBounds | undefined,
  Context,
  Effect.Effect<readonly EntryRecord[]>
> = Function.dual(
  4,
  Effect.fn("activeEntries")(function* (
    storage: Storage,
    conversationId: ConversationId,
    bounds: ContextBounds | undefined,
    context: Context,
  ) {
    if (bounds === undefined) return [];
    const entries = yield* scanRange(storage, conversationId, rangeQuery(bounds), context);
    return selectActive(bounds.head, entries);
  }),
);
