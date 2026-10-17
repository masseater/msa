import type { AssistantMessage, Message } from "@msa/ai";
import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { SystemEntry } from "../entries.ts";
import { orderToolResults } from "./context-order.ts";
import type {
  ContextEdit,
  ContextView,
  ConversationId,
  Dual2,
  Dual3,
  EntryId,
  EntryQuery,
  EntryRecord,
  Storage,
} from "./types.ts";
import { scanAll } from "./util.ts";

const SCAN_PAGE_SIZE = 256;
const EXCLUDED_STOP_REASONS: ReadonlySet<AssistantMessage["stopReason"]> = new Set([
  "aborted",
  "error",
  "deferred",
]);

export type ContextBounds = {
  readonly head: (EntryRecord & { readonly head: EntryId }) | undefined;
  readonly tail: EntryId;
};

export type ContextRange = {
  readonly bounds: ContextBounds;
  readonly entries: readonly EntryRecord[];
  readonly view: ContextView;
  readonly edited: ReadonlySet<EntryId>;
  readonly settled: readonly Message[];
  readonly open: readonly Message[];
  readonly baseline: Baseline;
};

export type Baseline = Message | null | undefined;

export function emptyView(): ContextView {
  return { head: undefined, entries: [], contributions: [], messages: [] };
}

export const deriveRange: Dual2<ContextBounds, readonly EntryRecord[], ContextRange> =
  Function.dual(2, (bounds: ContextBounds, entries: readonly EntryRecord[]): ContextRange => {
    const edits = new Map<EntryId, ContextEdit>();
    for (const entry of entries) for (const edit of entry.edits ?? []) edits.set(edit.target, edit);
    const active = selectActive(bounds.head, entries);
    const contributions = active.map((entry) => contribute(entry, edits.get(entry.id)));
    const { settled, open } = settle([], contributions.flat());
    const baseline = findBaseline(bounds.head, active);
    const messages = leadWithSystem([...settled, ...orderToolResults(open)], baseline);
    const view = { head: bounds.head, entries: active, contributions, messages };
    return { bounds, entries, view, edited: new Set(edits.keys()), settled, open, baseline };
  });

export const extendRange: Dual3<ContextRange, ContextBounds, readonly EntryRecord[], ContextRange> =
  Function.dual(
    3,
    (
      previous: ContextRange,
      bounds: ContextBounds,
      added: readonly EntryRecord[],
    ): ContextRange => {
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
      const { settled, open } = settle(previous.settled, [
        ...previous.open,
        ...contributions.flat(),
      ]);
      const baseline =
        previous.baseline === undefined ? findBaseline(bounds.head, added) : previous.baseline;
      const view = {
        head: bounds.head,
        entries: [...previous.view.entries, ...added],
        contributions: [...previous.view.contributions, ...contributions],
        messages: leadWithSystem([...settled, ...orderToolResults(open)], baseline),
      };
      return { bounds, entries, view, edited: previous.edited, settled, open, baseline };
    },
  );

function findBaseline(head: ContextBounds["head"], entries: readonly EntryRecord[]): Baseline {
  for (const entry of entries) {
    if (head !== undefined && entry.id <= head.id) continue;
    if (SystemEntry.is(entry))
      return entry.model?.find((message) => message.role === "system") ?? null;
    if (head === undefined && carriesSystemMessage(entry)) return null;
  }
  return undefined;
}

function carriesSystemMessage(entry: EntryRecord): boolean {
  const isSystem = (message: Message) => message.role === "system";
  return (
    (entry.model?.some(isSystem) ?? false) ||
    (entry.edits?.some((edit) => edit.action === "replace" && edit.messages.some(isSystem)) ??
      false)
  );
}

function leadWithSystem(messages: Message[], baseline: Baseline): Message[] {
  const index = messages.findIndex((message) => message.role === "system");
  if (index <= 0) return messages;
  const system = messages[index]!;
  if (system !== baseline && messages.slice(0, index).some((message) => message.role !== "user")) {
    return messages;
  }
  return [system, ...messages.slice(0, index), ...messages.slice(index + 1)];
}

function contribute(entry: EntryRecord, edit: ContextEdit | undefined): readonly Message[] {
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
  if (last <= 0) return { settled, open };
  return {
    settled: [...settled, ...orderToolResults(open.slice(0, last))],
    open: open.slice(last),
  };
}

export function rangeQuery(bounds: ContextBounds): Omit<EntryQuery, "conversationId"> {
  const head = bounds.head;
  return head === undefined
    ? { maxEntryId: bounds.tail }
    : { minEntryId: head.head, maxEntryId: bounds.tail };
}

export const scanRange = Effect.fn("scanRange")(function* (
  storage: Storage,
  conversationId: ConversationId,
  range: Omit<EntryQuery, "conversationId">,
  context: Context,
) {
  const entries = yield* scanAll((cursor) =>
    storage.scanEntries({ conversationId, ...range }, SCAN_PAGE_SIZE, cursor, context),
  );
  return entries.reverse();
});

export const selectActive: Dual2<
  ContextBounds["head"],
  readonly EntryRecord[],
  readonly EntryRecord[]
> = Function.dual(
  2,
  (head: ContextBounds["head"], range: readonly EntryRecord[]): readonly EntryRecord[] =>
    head === undefined ? range : [head, ...range.filter((entry) => entry.head === undefined)],
);
