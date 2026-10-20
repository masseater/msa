import type { AssistantMessage, Message } from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import entriesModule from "../entries.ts";
import contextOrder from "./context-order.ts";
import type contextRangeTypes from "./context-range.types.ts";
import type typesModule from "./types.types.ts";
import util from "./util.ts";

const { orderToolResults } = contextOrder;
const { SystemEntry } = entriesModule;
const { scanAll } = util;

const SCAN_PAGE_SIZE = 256;
const EXCLUDED_STOP_REASONS: ReadonlySet<AssistantMessage["stopReason"]> = new Set([
  "aborted",
  "error",
  "deferred",
]);

function emptyView(): typesModule.ContextView {
  return { contributions: [], entries: [], head: undefined, messages: [] };
}

const deriveRange: typesModule.Dual2<
  contextRangeTypes.ContextBounds,
  readonly typesModule.EntryRecord[],
  contextRangeTypes.ContextRange
> = Function.dual(
  2,
  (
    bounds: contextRangeTypes.ContextBounds,
    entries: readonly typesModule.EntryRecord[],
  ): contextRangeTypes.ContextRange => {
    const edits = new Map<typesModule.EntryId, typesModule.ContextEdit>();
    for (const entry of entries) for (const edit of entry.edits ?? []) edits.set(edit.target, edit);
    const active = selectActive(bounds.head, entries);
    const contributions = active.map((entry) => contribute(entry, edits.get(entry.id)));
    const { settled, open } = settle([], contributions.flat());
    const baseline = findBaseline(bounds.head, active);
    const messages = leadWithSystem([...settled, ...orderToolResults(open)], baseline);
    const view = { contributions, entries: active, head: bounds.head, messages };
    return { baseline, bounds, edited: new Set(edits.keys()), entries, open, settled, view };
  },
);

const extendRange: typesModule.Dual3<
  contextRangeTypes.ContextRange,
  contextRangeTypes.ContextBounds,
  readonly typesModule.EntryRecord[],
  contextRangeTypes.ContextRange
> = Function.dual(
  3,
  (
    previous: contextRangeTypes.ContextRange,
    bounds: contextRangeTypes.ContextBounds,
    added: readonly typesModule.EntryRecord[],
  ): contextRangeTypes.ContextRange => {
    const entries = [...previous.entries, ...added];
    if (
      added.some(
        (entry) =>
          entry.edits !== undefined || entry.head !== undefined || previous.edited.has(entry.id),
      )
    ) {
      return deriveRange(bounds, entries);
    }
    const contributions = added.map((entry) => contribute(entry, undefined));
    const { settled, open } = settle(previous.settled, [...previous.open, ...contributions.flat()]);
    const baseline =
      previous.baseline === undefined ? findBaseline(bounds.head, added) : previous.baseline;
    const view = {
      contributions: [...previous.view.contributions, ...contributions],
      entries: [...previous.view.entries, ...added],
      head: bounds.head,
      messages: leadWithSystem([...settled, ...orderToolResults(open)], baseline),
    };
    return { baseline, bounds, edited: previous.edited, entries, open, settled, view };
  },
);

function findBaseline(
  head: contextRangeTypes.ContextBounds["head"],
  entries: readonly typesModule.EntryRecord[],
): contextRangeTypes.Baseline {
  for (const entry of entries) {
    if (head !== undefined && entry.id <= head.id) continue;
    if (SystemEntry.is(entry))
      return entry.model?.find((message) => message.role === "system") ?? null;
    if (head === undefined && carriesSystemMessage(entry)) return null;
  }
  return undefined;
}

function carriesSystemMessage(entry: typesModule.EntryRecord): boolean {
  const isSystem = (message: Message) => message.role === "system";
  return (
    (entry.model?.some(isSystem) ?? false) ||
    (entry.edits?.some((edit) => edit.action === "replace" && edit.messages.some(isSystem)) ??
      false)
  );
}

function leadWithSystem(messages: Message[], baseline: contextRangeTypes.Baseline): Message[] {
  const index = messages.findIndex((message) => message.role === "system");
  if (index <= 0) return messages;
  const system = messages[index]!;
  if (system !== baseline && messages.slice(0, index).some((message) => message.role !== "user")) {
    return messages;
  }
  return [system, ...messages.slice(0, index), ...messages.slice(index + 1)];
}

function contribute(
  entry: typesModule.EntryRecord,
  edit: typesModule.ContextEdit | undefined,
): readonly Message[] {
  if (edit?.action === "omit") return Object.freeze([]);
  const contributed = edit?.action === "replace" ? edit.messages : (entry.model ?? []);
  return Object.freeze(
    contributed.filter(
      (message) => message.role !== "assistant" || !EXCLUDED_STOP_REASONS.has(message.stopReason),
    ),
  );
}

function settle(
  settled: readonly Message[],
  open: readonly Message[],
): { readonly settled: readonly Message[]; readonly open: readonly Message[] } {
  const last = open.findLastIndex((message) => message.role === "assistant");
  if (last <= 0) return { open, settled };
  return {
    open: open.slice(last),
    settled: [...settled, ...orderToolResults(open.slice(0, last))],
  };
}

function rangeQuery(
  bounds: contextRangeTypes.ContextBounds,
): Omit<typesModule.EntryQuery, "conversationId"> {
  const head = bounds.head;
  return head === undefined
    ? { maxEntryId: bounds.tail }
    : { maxEntryId: bounds.tail, minEntryId: head.head };
}

const scanRange = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  conversationId: typesModule.ConversationId,
  range: Omit<typesModule.EntryQuery, "conversationId">,
  context: chordTypes.Context,
) {
  const entries = yield* scanAll((cursor) =>
    storage.scanEntries({ conversationId, ...range }, SCAN_PAGE_SIZE, cursor, context),
  );
  return entries.reverse();
});

const selectActive: typesModule.Dual2<
  contextRangeTypes.ContextBounds["head"],
  readonly typesModule.EntryRecord[],
  readonly typesModule.EntryRecord[]
> = Function.dual(
  2,
  (
    head: contextRangeTypes.ContextBounds["head"],
    range: readonly typesModule.EntryRecord[],
  ): readonly typesModule.EntryRecord[] =>
    head === undefined ? range : [head, ...range.filter((entry) => entry.head === undefined)],
);

const contextRange = {
  deriveRange,
  emptyView,
  extendRange,
  rangeQuery,
  scanRange,
  selectActive,
};

export default contextRange;
