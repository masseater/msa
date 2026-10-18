import { dual } from "effect/Function";

import { type NonEmptyPath, type Op, type Path, track } from "../../src/delta/index.ts";
import type { Distribution } from "./conversation-view-model.ts";
import type {
  EntryKind,
  JsonObject,
  MountedKey,
  TrackerLike,
  TranscriptEntry,
} from "./conversation-view-types.ts";

export const payloadText: {
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

const entryData = (id: number, kind: EntryKind): JsonObject => {
  switch (kind) {
    case "user":
      return { role: "user", content: payloadText(2_400 + (id % 600), id), timestamp: id * 10 };
    case "assistant":
      return {
        role: "assistant",
        content: [{ type: "text", text: payloadText(5_500 + (id % 2_000), id) }],
        model: "claude-sonnet-provisional",
        usage: { input: 2_048 + id, output: 512 + (id % 256), cached: id % 1_024 },
      };
    case "tool-result":
      return {
        callId: `call-${id}`,
        tool: id % 2 === 0 ? "read" : "bash",
        status: "completed",
        output: payloadText(11_000 + (id % 5_000), id),
      };
    case "application":
      return {
        namespace: "pico5.provisional",
        event: "artifact.updated",
        payload: payloadText(3_200 + (id % 1_000), id),
      };
  }
};

export interface EntrySpec {
  readonly id: number;
  readonly parent: number | null;
  readonly kind: EntryKind;
}

export const makeEntry = ({ id, parent, kind }: EntrySpec): TranscriptEntry => ({
  id,
  parent,
  kind,
  data: entryData(id, kind),
});

const entryCycle: readonly EntryKind[] = [
  "user",
  "assistant",
  "assistant",
  "tool-result",
  "application",
  "assistant",
  "tool-result",
];

export const entryKindAt = (index: number): EntryKind => entryCycle[index % entryCycle.length]!;

export const resolveActiveLineage: {
  (head: number | null): (records: ReadonlyMap<number, TranscriptEntry>) => TranscriptEntry[];
  (records: ReadonlyMap<number, TranscriptEntry>, head: number | null): TranscriptEntry[];
} = dual(
  2,
  (records: ReadonlyMap<number, TranscriptEntry>, head: number | null): TranscriptEntry[] => {
    const reversed: TranscriptEntry[] = [];
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

export function createTracker<T extends object>(value: T): TrackerLike<T> {
  return track(value) as unknown as TrackerLike<T>;
}

const prefixOperation = (prefix: Path, operation: Op): Op => {
  if (operation[0] === "r") return ["s", prefix as NonEmptyPath, operation[1]];
  const path = [...prefix, ...operation[1]];
  switch (operation[0]) {
    case "s":
      return ["s", path as unknown as NonEmptyPath, operation[2]];
    case "d":
      return ["d", path as unknown as NonEmptyPath];
    case "a":
      return ["a", path as unknown as NonEmptyPath, operation[2]];
    case "t":
      return ["t", path as unknown as NonEmptyPath, operation[2]];
    case "p":
      return ["p", path, operation[2], operation[3], operation[4]];
    case "m":
      return ["m", path, operation[2]];
    default:
      throw new TypeError(`Unknown operation ${(operation as readonly [unknown])[0]}`);
  }
};

export const prefixDocumentOperations: {
  (operations: readonly Op[]): (key: MountedKey) => Op[];
  (key: MountedKey, operations: readonly Op[]): Op[];
} = dual(2, (key: MountedKey, operations: readonly Op[]): Op[] => {
  const prefix: Path = ["docs", key];
  return operations.map((operation) => prefixOperation(prefix, operation));
});

export const commonEntryPrefix: {
  (right: readonly TranscriptEntry[]): (left: readonly TranscriptEntry[]) => number;
  (left: readonly TranscriptEntry[], right: readonly TranscriptEntry[]): number;
} = dual(2, (left: readonly TranscriptEntry[], right: readonly TranscriptEntry[]): number => {
  let index = 0;
  while (index < left.length && index < right.length && left[index]!.id === right[index]!.id)
    index += 1;
  return index;
});

export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0)
    return { count: 0, totalMs: 0, medianMs: 0, p95Ms: 0, p99Ms: 0, minMs: 0, maxMs: 0 };
  const ordered = [...values].sort((left, right) => left - right);
  return {
    count: ordered.length,
    totalMs: ordered.reduce((total, value) => total + value, 0),
    medianMs: ordered[Math.floor(ordered.length / 2)]!,
    p95Ms: ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))]!,
    p99Ms: ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.99))]!,
    minMs: ordered[0]!,
    maxMs: ordered.at(-1)!,
  };
}
