import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from "@msa/ai";
import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { SystemEntry } from "../entries.ts";
import { idFromNumber } from "../ids.ts";
import type { SessionImpl } from "../session/session.ts";
import type {
  ContextEdit,
  ConversationId,
  EntryId,
  EntryQuery,
  EntryRecord,
  Storage,
} from "../types.ts";
import type { ContextView } from "./types.ts";
import { scanAll } from "./util.ts";

const SCAN_PAGE_SIZE = 256;
const EXCLUDED_STOP_REASONS: ReadonlySet<AssistantMessage["stopReason"]> = new Set([
  "aborted",
  "error",
  "deferred",
]);
const MISSING_RESULT_TEXT = "Tool result unavailable: history ends before this call completed.";

export type ContextBounds = {
  readonly head: (EntryRecord & { readonly head: EntryId }) | undefined;
  readonly tail: EntryId;
};

export async function captureContextBounds(
  storage: Storage,
  conversationId: ConversationId,
  context: Context,
  at?: EntryId,
): Promise<ContextBounds | undefined> {
  let tail: EntryId | undefined;
  if (at === undefined) {
    tail = (await storage.scanEntries({ conversationId }, 1, undefined, context)).items[0]?.id;
    if (tail === undefined) return undefined;
  } else {
    if ((await storage.entry(conversationId, at, context)) === undefined) {
      throw new Error(`Entry ${at} is not visible from conversation ${conversationId}`);
    }
    tail = at;
  }
  return { head: await storage.findLatestHeadMarker(conversationId, tail, context), tail };
}

export type ContextRange = {
  readonly bounds: ContextBounds;
  readonly entries: readonly EntryRecord[];
  readonly view: ContextView;
  readonly edited: ReadonlySet<EntryId>;
  readonly settled: readonly Message[];
  readonly open: readonly Message[];
  readonly baseline: Baseline;
};

type Baseline = Message | null | undefined;

export async function readContextFrom(
  session: SessionImpl,
  storage: Storage,
  conversationId: ConversationId,
  context: Context,
  at: EntryId | undefined,
  previous: ContextRange | undefined,
): Promise<{ readonly view: ContextView; readonly range: ContextRange | undefined }> {
  const bounds = await session.readOnLine(() =>
    captureContextBounds(storage, conversationId, context, at),
  );
  if (bounds === undefined) return { view: emptyView(), range: undefined };
  freezeJson(bounds.head);
  let range: ContextRange;
  if (previous === undefined || previous.bounds.head?.id !== bounds.head?.id) {
    range = deriveRange(
      bounds,
      freezeJson(await scanRange(storage, conversationId, rangeQuery(bounds), context)),
    );
  } else if (bounds.tail === previous.bounds.tail) {
    range = previous;
  } else if (bounds.tail < previous.bounds.tail) {
    range = deriveRange(
      bounds,
      previous.entries.filter((entry) => entry.id <= bounds.tail),
    );
  } else {
    const minEntryId = idFromNumber<EntryId>(previous.bounds.tail + 1);
    const added = await scanRange(
      storage,
      conversationId,
      { minEntryId, maxEntryId: bounds.tail },
      context,
    );
    range = extendRange(previous, bounds, freezeJson(added));
  }
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
}

export async function readContext(
  session: SessionImpl,
  storage: Storage,
  conversationId: ConversationId,
  context: Context,
  at?: EntryId,
): Promise<ContextView> {
  const bounds = await session.readOnLine(() =>
    captureContextBounds(storage, conversationId, context, at),
  );
  return deriveContext(storage, conversationId, bounds, context);
}

export async function deriveContext(
  storage: Storage,
  conversationId: ConversationId,
  bounds: ContextBounds | undefined,
  context: Context,
): Promise<ContextView> {
  if (bounds === undefined) return emptyView();
  return deriveRange(bounds, await scanRange(storage, conversationId, rangeQuery(bounds), context))
    .view;
}

function emptyView(): ContextView {
  return { head: undefined, entries: [], contributions: [], messages: [] };
}

function deriveRange(bounds: ContextBounds, entries: readonly EntryRecord[]): ContextRange {
  const edits = new Map<EntryId, ContextEdit>();
  for (const entry of entries) for (const edit of entry.edits ?? []) edits.set(edit.target, edit);
  const active = selectActive(bounds.head, entries);
  const contributions = active.map((entry) => contribute(entry, edits.get(entry.id)));
  const { settled, open } = settle([], contributions.flat());
  const baseline = findBaseline(bounds.head, active);
  const messages = leadWithSystem([...settled, ...orderToolResults(open)], baseline);
  const view = { head: bounds.head, entries: active, contributions, messages };
  return { bounds, entries, view, edited: new Set(edits.keys()), settled, open, baseline };
}

function extendRange(
  previous: ContextRange,
  bounds: ContextBounds,
  added: readonly EntryRecord[],
): ContextRange {
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
    head: bounds.head,
    entries: [...previous.view.entries, ...added],
    contributions: [...previous.view.contributions, ...contributions],
    messages: leadWithSystem([...settled, ...orderToolResults(open)], baseline),
  };
  return { bounds, entries, view, edited: previous.edited, settled, open, baseline };
}

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

const deeplyFrozen = new WeakSet<object>();

function freezeJson<T>(value: T): T {
  if (value === null || typeof value !== "object" || deeplyFrozen.has(value)) return value;
  for (const child of Object.values(value)) freezeJson(child);
  Object.freeze(value);
  deeplyFrozen.add(value);
  return value;
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

export async function activeEntries(
  storage: Storage,
  conversationId: ConversationId,
  bounds: ContextBounds | undefined,
  context: Context,
): Promise<readonly EntryRecord[]> {
  if (bounds === undefined) return [];
  return selectActive(
    bounds.head,
    await scanRange(storage, conversationId, rangeQuery(bounds), context),
  );
}

function rangeQuery(bounds: ContextBounds): Omit<EntryQuery, "conversationId"> {
  const head = bounds.head;
  return head === undefined
    ? { maxEntryId: bounds.tail }
    : { minEntryId: head.head, maxEntryId: bounds.tail };
}

async function scanRange(
  storage: Storage,
  conversationId: ConversationId,
  range: Omit<EntryQuery, "conversationId">,
  context: Context,
): Promise<EntryRecord[]> {
  const entries = await Effect.runPromise(
    scanAll((cursor) =>
      storage.scanEntries({ conversationId, ...range }, SCAN_PAGE_SIZE, cursor, context),
    ),
  );
  return entries.reverse();
}

function selectActive(
  head: ContextBounds["head"],
  range: readonly EntryRecord[],
): readonly EntryRecord[] {
  return head === undefined ? range : [head, ...range.filter((entry) => entry.head === undefined)];
}

export function orderToolResults(messages: readonly Message[]): Message[] {
  const ordered: Message[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === "toolResult") continue;
    ordered.push(message);
    if (message.role !== "assistant") continue;
    const calls = message.content.filter(
      (content): content is ToolCall => content.type === "toolCall",
    );
    if (calls.length === 0) continue;
    const results = new Map<string, number>();
    for (
      let next = index + 1;
      next < messages.length && messages[next]!.role !== "assistant";
      next++
    ) {
      const candidate = messages[next]!;
      if (candidate.role === "toolResult" && !results.has(candidate.toolCallId)) {
        results.set(candidate.toolCallId, next);
      }
    }
    for (const call of calls) {
      const resultIndex = results.get(call.id);
      ordered.push(
        resultIndex === undefined ? missingResult(call, message.timestamp) : messages[resultIndex]!,
      );
    }
  }
  return ordered;
}

function missingResult(call: ToolCall, timestamp: number): ToolResultMessage {
  return freezeJson({
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: "text", text: MISSING_RESULT_TEXT }],
    isError: true,
    details: { reason: "missing_result" },
    timestamp,
  });
}
