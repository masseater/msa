import { Function } from "effect";

import type { DocumentId, Seq, StorageWrite, TaskId } from "../../types.ts";
import {
  type EncodedCommit,
  FORMAT_VERSION,
  isCurrentOnly,
  jsonLine,
  type MainMarker,
  type MainOperation,
  type SidecarPayload,
  type SidecarRecord,
  sidecarFileName,
  type StoredTask,
} from "./format.ts";

class SidecarBatch {
  readonly records = new Map<string, SidecarRecord[]>();
  private readonly seq: Seq;
  private nextOrdinal = 0;

  constructor(seq: Seq) {
    this.seq = seq;
  }

  add(file: string, payload: SidecarPayload): number {
    const ordinal = this.nextOrdinal++;
    let fileRecords = this.records.get(file);
    if (fileRecords === undefined) {
      fileRecords = [];
      this.records.set(file, fileRecords);
    }
    fileRecords.push({ format: FORMAT_VERSION, type: "record", seq: this.seq, ordinal, payload });
    return ordinal;
  }
}

const mainOperation = (batch: SidecarBatch, write: StorageWrite): MainOperation | undefined => {
  switch (write.type) {
    case "conversation":
    case "entry":
    case "submission":
    case "document.retire":
      return write;
    case "task":
      if (write.value.state.status === "terminal") return write;
      return {
        type: "task.sidecar",
        id: write.value.id,
        ordinal: batch.add(sidecarFileName("task", write.value.id), {
          type: "task",
          value: write.value,
        }),
      };
    case "document.create":
      return {
        type: "document.create",
        record: write.record,
        ordinal: batch.add(sidecarFileName("doc", write.record.id), {
          type: "document",
          id: write.record.id,
          content: write.content,
        }),
      };
    case "document.change":
      return {
        type: "document.change",
        id: write.id,
        ordinal: batch.add(sidecarFileName("doc", write.id), {
          type: "document",
          id: write.id,
          content: write.content,
        }),
      };
    case "document.copy":
      return undefined;
  }
};

export const encodeCommit: {
  (writes: readonly StorageWrite[]): (seq: Seq) => EncodedCommit;
  (seq: Seq, writes: readonly StorageWrite[]): EncodedCommit;
} = Function.dual(2, (seq: Seq, writes: readonly StorageWrite[]): EncodedCommit => {
  const batch = new SidecarBatch(seq);
  const mainWrites: MainOperation[] = [];
  for (const write of writes) {
    const operation = mainOperation(batch, write);
    if (operation !== undefined) mainWrites.push(operation);
  }
  const sidecars = new Map<string, string>();
  for (const [file, fileRecords] of batch.records) {
    sidecars.set(file, fileRecords.map((record) => jsonLine(record)).join(""));
  }
  const marker: MainMarker = { format: FORMAT_VERSION, type: "commit", seq, writes: mainWrites };
  return { marker: jsonLine(marker), sidecars };
});

export type SidecarState = {
  readonly currentOnlyDocuments: ReadonlySet<DocumentId>;
  readonly liveTaskSidecars: ReadonlySet<TaskId>;
};

type CommitShape = {
  readonly createdCurrentOnly: Set<DocumentId>;
  readonly retired: Set<DocumentId>;
  readonly bases: Set<DocumentId>;
  readonly finalTasks: Map<TaskId, StoredTask>;
};

const commitShape = (writes: readonly StorageWrite[]): CommitShape => {
  const shape: CommitShape = {
    createdCurrentOnly: new Set(),
    retired: new Set(),
    bases: new Set(),
    finalTasks: new Map(),
  };
  for (const write of writes) {
    if (write.type === "document.create" && isCurrentOnly(write.record))
      shape.createdCurrentOnly.add(write.record.id);
    else if (write.type === "document.change" && write.content.kind === "base")
      shape.bases.add(write.id);
    else if (write.type === "document.retire") shape.retired.add(write.id);
    else if (write.type === "task") shape.finalTasks.set(write.value.id, write.value);
  }
  return shape;
};

export const planReclamations: {
  (
    writes: readonly StorageWrite[],
    encoded: EncodedCommit,
  ): (state: SidecarState) => ReadonlyMap<string, string>;
  (
    state: SidecarState,
    writes: readonly StorageWrite[],
    encoded: EncodedCommit,
  ): ReadonlyMap<string, string>;
} = Function.dual(
  3,
  (
    state: SidecarState,
    writes: readonly StorageWrite[],
    encoded: EncodedCommit,
  ): ReadonlyMap<string, string> => {
    const shape = commitShape(writes);
    const replacements = new Map<string, string>();
    const isCurrentOnlyDocument = (id: DocumentId): boolean =>
      state.currentOnlyDocuments.has(id) || shape.createdCurrentOnly.has(id);
    for (const id of shape.retired) {
      if (isCurrentOnlyDocument(id)) replacements.set(sidecarFileName("doc", id), "");
    }
    for (const id of shape.bases) {
      if (!isCurrentOnlyDocument(id) || shape.retired.has(id)) continue;
      const file = sidecarFileName("doc", id);
      const content = encoded.sidecars.get(file);
      if (content !== undefined) replacements.set(file, content);
    }
    for (const [id, task] of shape.finalTasks) {
      if (
        task.state.status === "terminal" &&
        (state.liveTaskSidecars.has(id) || encoded.sidecars.has(sidecarFileName("task", id)))
      ) {
        replacements.set(sidecarFileName("task", id), "");
      }
    }
    return replacements;
  },
);

export type MutableSidecarState = {
  readonly currentOnlyDocuments: Set<DocumentId>;
  readonly liveTaskSidecars: Set<TaskId>;
};

export const adoptSidecarState: {
  (writes: readonly StorageWrite[]): (state: MutableSidecarState) => void;
  (state: MutableSidecarState, writes: readonly StorageWrite[]): void;
} = Function.dual(2, (state: MutableSidecarState, writes: readonly StorageWrite[]): void => {
  for (const write of writes) {
    if (write.type === "document.create") {
      if (isCurrentOnly(write.record)) state.currentOnlyDocuments.add(write.record.id);
    } else if (write.type === "task") {
      if (write.value.state.status === "terminal") state.liveTaskSidecars.delete(write.value.id);
      else state.liveTaskSidecars.add(write.value.id);
    }
  }
});
