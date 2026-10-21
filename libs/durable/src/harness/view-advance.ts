import contextModule from "@msa/chord/context";
import type deltaTypes from "@msa/chord/delta.types";
import applyModule from "@msa/chord/delta/apply";
import type chordTypes from "@msa/chord/index.types";
import { Function } from "effect";

import sessionState from "../session/session-state.ts";
import type typesModule from "./types.types.ts";
import viewMount from "./view-mount.ts";
import type viewMountTypes from "./view-mount.types.ts";

const { withoutAbortSignal } = contextModule;
const { applyImmutable } = applyModule;

const { contained } = sessionState;
const { MOUNTED_KINDS } = viewMount;

const advance: typesModule.Dual5<
  typesModule.ConversationId,
  viewMountTypes.Mount,
  typesModule.CommitPublication,
  chordTypes.Context,
  (error: unknown) => void,
  void
> = Function.dual(
  5,
  (
    id: typesModule.ConversationId,
    mount: viewMountTypes.Mount,
    publication: typesModule.CommitPublication,
    context: chordTypes.Context,
    report: (error: unknown) => void,
  ): void => {
    const docOps: deltaTypes.Op[] = [];
    const entryOps: deltaTypes.Op[] = [];
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

type EntryList = { entries: readonly typesModule.EntryRecord[]; owned: boolean };

function addEntry(
  list: EntryList,
  entry: typesModule.EntryRecord,
  entryOps: deltaTypes.Op[],
): void {
  const value = entry as unknown as chordTypes.JsonValue;
  if (entry.head === undefined) {
    entryOps.push(["p", ["entries"], list.entries.length, 0, [value]]);
    const entries = list.owned ? (list.entries as typesModule.EntryRecord[]) : list.entries.slice();
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
  mount: viewMountTypes.Mount,
  change: Extract<typesModule.CommitPublication["changes"][number], { type: "document" }>,
  docOps: deltaTypes.Op[],
): void {
  const kind = change.record.kind;
  if (!MOUNTED_KINDS.has(kind) || change.record.key !== undefined) return;
  const path: deltaTypes.NonEmptyPath = ["docs", kind];
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

function prefixed(op: deltaTypes.Op, prefix: deltaTypes.NonEmptyPath): deltaTypes.Op {
  const at = (path: deltaTypes.Path): deltaTypes.NonEmptyPath =>
    [...prefix, ...path] as unknown as deltaTypes.NonEmptyPath;
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

const viewAdvance = {
  advance,
};

export default viewAdvance;
