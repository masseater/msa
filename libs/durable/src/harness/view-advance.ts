import type { Context, JsonValue } from "@msa/chord";
import { withoutAbortSignal } from "@msa/chord/context";
import type { NonEmptyPath, Op, Path } from "@msa/chord/delta";
import { applyImmutable } from "@msa/chord/delta/apply";
import { Function } from "effect";

import { contained } from "../session/session.ts";
import type { CommitPublication, ConversationId, Dual5, EntryRecord } from "./types.ts";
import type { Mount } from "./view-mount.ts";
import { MOUNTED_KINDS } from "./view-mount.ts";

export const advance: Dual5<
  ConversationId,
  Mount,
  CommitPublication,
  Context,
  (error: unknown) => void,
  void
> = Function.dual(
  5,
  (
    id: ConversationId,
    mount: Mount,
    publication: CommitPublication,
    context: Context,
    report: (error: unknown) => void,
  ): void => {
    const docOps: Op[] = [];
    const entryOps: Op[] = [];
    const list: EntryList = { entries: mount.value.entries, owned: false };
    for (const change of publication.changes) {
      if (change.type === "entry" && change.value.conversationId === id) {
        addEntry(list, change.value, entryOps);
      } else if (change.type === "document" && change.conversationId === id) {
        applyDocument(mount, change, docOps);
      }
    }
    const { entries } = list;
    const before = mount.value;
    const ops = [...docOps, ...entryOps];
    const frameContext = withoutAbortSignal(context);
    if (ops.length > 0) {
      const value = docOps.length === 0 ? mount.value : applyImmutable(mount.value, docOps);
      mount.value = entries === value.entries ? value : { ...value, entries };
      for (const observer of [...mount.observers]) {
        contained(() => observer.advance?.(mount.value, ops, frameContext), report);
      }
    }
    for (const observer of [...mount.observers]) {
      contained(
        () => observer.publication?.(before, mount.value, ops, publication, frameContext),
        report,
      );
    }
  },
);

type EntryList = { entries: readonly EntryRecord[]; owned: boolean };

function addEntry(list: EntryList, entry: EntryRecord, entryOps: Op[]): void {
  const value = entry as unknown as JsonValue;
  if (entry.head === undefined) {
    entryOps.push(["p", ["entries"], list.entries.length, 0, [value]]);
    const entries = list.owned ? (list.entries as EntryRecord[]) : list.entries.slice();
    entries.push(entry);
    list.entries = entries;
    list.owned = true;
    return;
  }
  const target = entry.head;
  let kept = list.entries.findIndex(
    (candidate) => candidate.head === undefined && candidate.id >= target,
  );
  if (kept < 0) kept = list.entries.length;
  entryOps.push(["p", ["entries"], 0, kept, [value]]);
  list.entries = [entry, ...list.entries.slice(kept)];
  list.owned = true;
}

function applyDocument(
  mount: Mount,
  change: Extract<CommitPublication["changes"][number], { type: "document" }>,
  docOps: Op[],
): void {
  const kind = change.record.kind;
  if (!MOUNTED_KINDS.has(kind) || change.record.key !== undefined) return;
  const path: NonEmptyPath = ["docs", kind];
  const mounted = mount.docs.get(kind);
  if (change.value === null) {
    if (mounted?.id !== change.record.id) return;
    mount.docs.delete(kind);
    docOps.push(["d", path]);
  } else if (mounted?.id === change.record.id && mounted.version === change.version) {
    for (const op of change.ops) docOps.push(prefixed(op, path));
  } else {
    mount.docs.set(kind, { id: change.record.id, version: change.version! });
    docOps.push(["s", path, change.value]);
  }
}

function prefixed(op: Op, prefix: NonEmptyPath): Op {
  const at = (path: Path): NonEmptyPath => [...prefix, ...path] as unknown as NonEmptyPath;
  switch (op[0]) {
    case "r":
      return ["s", prefix, op[1]];
    case "p":
      return ["p", at(op[1]), op[2], op[3], op[4]];
    case "m":
      return ["m", at(op[1]), op[2]];
    case "s":
      return ["s", at(op[1]), op[2]];
    case "d":
      return ["d", at(op[1])];
    case "a":
      return ["a", at(op[1]), op[2]];
    case "t":
      return ["t", at(op[1]), op[2]];
  }
}
