import { dual } from "effect/Function";

import delta from "../../src/delta/index.ts";
import type deltaTypes from "../../src/delta/index.types.ts";
import type conversationViewContentTypes from "./conversation-view-content.types.ts";
import type conversationViewModelTypes from "./conversation-view-model.types.ts";
import type conversationViewTypes from "./conversation-view-types.types.ts";

const { track } = delta;

const payloadText: {
  (seed: number): (length: number) => string;
  (length: number, seed: number): string;
} = dual(2, (length: number, seed: number): string => {
  const bytes = Buffer.allocUnsafe(length);
  let state = (seed ^ 0x9e3779b9) >>> 0;
  for (let index = 0; index < length; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = 32 + ((state >>> 0) % 95);
  }
  return bytes.toString("ascii");
});

const entryData = (
  id: number,
  kind: conversationViewTypes.EntryKind,
): conversationViewTypes.JsonObject => {
  switch (kind) {
    case "user":
      return { content: payloadText(2_400 + (id % 600), id), role: "user", timestamp: id * 10 };
    case "assistant":
      return {
        content: [{ text: payloadText(5_500 + (id % 2_000), id), type: "text" }],
        model: "claude-sonnet-provisional",
        role: "assistant",
        usage: { cached: id % 1_024, input: 2_048 + id, output: 512 + (id % 256) },
      };
    case "tool-result":
      return {
        callId: `call-${id}`,
        output: payloadText(11_000 + (id % 5_000), id),
        status: "completed",
        tool: id % 2 === 0 ? "read" : "bash",
      };
    case "application":
      return {
        event: "artifact.updated",
        namespace: "pico5.provisional",
        payload: payloadText(3_200 + (id % 1_000), id),
      };
  }
};

const makeEntry = ({
  id,
  parent,
  kind,
}: conversationViewContentTypes.EntrySpec): conversationViewTypes.TranscriptEntry => ({
  data: entryData(id, kind),
  id,
  kind,
  parent,
});

const entryCycle: readonly conversationViewTypes.EntryKind[] = [
  "user",
  "assistant",
  "assistant",
  "tool-result",
  "application",
  "assistant",
  "tool-result",
];

const entryKindAt = (index: number): conversationViewTypes.EntryKind =>
  entryCycle[index % entryCycle.length]!;

const resolveActiveLineage: {
  (
    head: number | null,
  ): (
    records: ReadonlyMap<number, conversationViewTypes.TranscriptEntry>,
  ) => conversationViewTypes.TranscriptEntry[];
  (
    records: ReadonlyMap<number, conversationViewTypes.TranscriptEntry>,
    head: number | null,
  ): conversationViewTypes.TranscriptEntry[];
} = dual(
  2,
  (
    records: ReadonlyMap<number, conversationViewTypes.TranscriptEntry>,
    head: number | null,
  ): conversationViewTypes.TranscriptEntry[] => {
    const reversed: conversationViewTypes.TranscriptEntry[] = [];
    const seen = new Set<number>();
    let current = head;
    while (current !== null) {
      if (seen.has(current)) throw new Error(`Transcript cycle at ${current}`);
      seen.add(current);
      const entry = records.get(current);
      if (entry === undefined) throw new Error(`Missing transcript entry ${current}`);
      reversed.push(entry);
      current = entry.parent;
    }
    reversed.reverse();
    return reversed;
  },
);

function createTracker<T extends object>(value: T): conversationViewTypes.TrackerLike<T> {
  return track(value) as unknown as conversationViewTypes.TrackerLike<T>;
}

const prefixOperation = (prefix: deltaTypes.Path, operation: deltaTypes.Op): deltaTypes.Op => {
  if (operation[0] === "r") return ["s", prefix as deltaTypes.NonEmptyPath, operation[1]];
  const path = [...prefix, ...operation[1]];
  switch (operation[0]) {
    case "s":
      return ["s", path as unknown as deltaTypes.NonEmptyPath, operation[2]];
    case "d":
      return ["d", path as unknown as deltaTypes.NonEmptyPath];
    case "a":
      return ["a", path as unknown as deltaTypes.NonEmptyPath, operation[2]];
    case "t":
      return ["t", path as unknown as deltaTypes.NonEmptyPath, operation[2]];
    case "p":
      return ["p", path, operation[2], operation[3], operation[4]];
    case "m":
      return ["m", path, operation[2]];
    default:
      throw new TypeError(`Unknown operation ${(operation as readonly [unknown])[0]}`);
  }
};

const prefixDocumentOperations: {
  (
    operations: readonly deltaTypes.Op[],
  ): (key: conversationViewTypes.MountedKey) => deltaTypes.Op[];
  (key: conversationViewTypes.MountedKey, operations: readonly deltaTypes.Op[]): deltaTypes.Op[];
} = dual(
  2,
  (
    key: conversationViewTypes.MountedKey,
    operations: readonly deltaTypes.Op[],
  ): deltaTypes.Op[] => {
    const prefix: deltaTypes.Path = ["docs", key];
    return operations.map((operation) => prefixOperation(prefix, operation));
  },
);

const commonEntryPrefix: {
  (
    right: readonly conversationViewTypes.TranscriptEntry[],
  ): (left: readonly conversationViewTypes.TranscriptEntry[]) => number;
  (
    left: readonly conversationViewTypes.TranscriptEntry[],
    right: readonly conversationViewTypes.TranscriptEntry[],
  ): number;
} = dual(
  2,
  (
    left: readonly conversationViewTypes.TranscriptEntry[],
    right: readonly conversationViewTypes.TranscriptEntry[],
  ): number => {
    let index = 0;
    while (index < left.length && index < right.length && left[index]!.id === right[index]!.id)
      index += 1;
    return index;
  },
);

function distribution(values: readonly number[]): conversationViewModelTypes.Distribution {
  if (values.length === 0)
    return { count: 0, maxMs: 0, medianMs: 0, minMs: 0, p95Ms: 0, p99Ms: 0, totalMs: 0 };
  const ordered = [...values].sort((left, right) => left - right);
  return {
    count: ordered.length,
    maxMs: ordered.at(-1)!,
    medianMs: ordered[Math.floor(ordered.length / 2)]!,
    minMs: ordered[0]!,
    p95Ms: ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))]!,
    p99Ms: ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.99))]!,
    totalMs: ordered.reduce((total, value) => total + value, 0),
  };
}

const conversationViewContent = {
  commonEntryPrefix,
  createTracker,
  distribution,
  entryKindAt,
  makeEntry,
  payloadText,
  prefixDocumentOperations,
  resolveActiveLineage,
};

export default conversationViewContent;
