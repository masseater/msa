import { Function } from "effect";

import type typesModule from "../../types.types.ts";
import type encodeTypes from "./encode.types.ts";
import formatModule from "./format.ts";
import type formatTypes from "./format.types.ts";

const { FORMAT_VERSION, isCurrentOnly, jsonLine, sidecarFileName } = formatModule;

class SidecarBatch {
  readonly records = new Map<string, formatTypes.SidecarRecord[]>();
  private readonly seq: typesModule.Seq;
  private nextOrdinal = 0;

  constructor(seq: typesModule.Seq) {
    this.seq = seq;
  }

  add(file: string, payload: formatTypes.SidecarPayload): number {
    const ordinal = this.nextOrdinal++;
    let fileRecords = this.records.get(file);
    if (fileRecords === undefined) {
      fileRecords = [];
      this.records.set(file, fileRecords);
    }
    fileRecords.push({ format: FORMAT_VERSION, ordinal, payload, seq: this.seq, type: "record" });
    return ordinal;
  }
}

const mainOperation = (
  batch: SidecarBatch,
  write: typesModule.StorageWrite,
): formatTypes.MainOperation | undefined => {
  switch (write.type) {
    case "conversation":
    case "entry":
    case "submission":
    case "document.retire":
      return write;
    case "task":
      if (write.value.state.status === "terminal") return write;
      return {
        id: write.value.id,
        ordinal: batch.add(sidecarFileName("task", write.value.id), {
          type: "task",
          value: write.value,
        }),
        type: "task.sidecar",
      };
    case "document.create":
      return {
        ordinal: batch.add(sidecarFileName("doc", write.record.id), {
          content: write.content,
          id: write.record.id,
          type: "document",
        }),
        record: write.record,
        type: "document.create",
      };
    case "document.change":
      return {
        id: write.id,
        ordinal: batch.add(sidecarFileName("doc", write.id), {
          content: write.content,
          id: write.id,
          type: "document",
        }),
        type: "document.change",
      };
    case "document.copy":
      return undefined;
  }
};

const encodeCommit: {
  (
    writes: readonly typesModule.StorageWrite[],
  ): (seq: typesModule.Seq) => formatTypes.EncodedCommit;
  (seq: typesModule.Seq, writes: readonly typesModule.StorageWrite[]): formatTypes.EncodedCommit;
} = Function.dual(
  2,
  (
    seq: typesModule.Seq,
    writes: readonly typesModule.StorageWrite[],
  ): formatTypes.EncodedCommit => {
    const batch = new SidecarBatch(seq);
    const mainWrites: formatTypes.MainOperation[] = [];
    for (const write of writes) {
      const operation = mainOperation(batch, write);
      if (operation !== undefined) mainWrites.push(operation);
    }
    const sidecars = new Map<string, string>();
    for (const [file, fileRecords] of batch.records) {
      sidecars.set(file, fileRecords.map((record) => jsonLine(record)).join(""));
    }
    const marker: formatTypes.MainMarker = {
      format: FORMAT_VERSION,
      seq,
      type: "commit",
      writes: mainWrites,
    };
    return { marker: jsonLine(marker), sidecars };
  },
);

type CommitShape = {
  readonly createdCurrentOnly: Set<typesModule.DocumentId>;
  readonly retired: Set<typesModule.DocumentId>;
  readonly bases: Set<typesModule.DocumentId>;
  readonly finalTasks: Map<typesModule.TaskId, formatTypes.StoredTask>;
};

const commitShape = (writes: readonly typesModule.StorageWrite[]): CommitShape => {
  const shape: CommitShape = {
    bases: new Set(),
    createdCurrentOnly: new Set(),
    finalTasks: new Map(),
    retired: new Set(),
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

const planReclamations: {
  (
    writes: readonly typesModule.StorageWrite[],
    encoded: formatTypes.EncodedCommit,
  ): (state: encodeTypes.SidecarState) => ReadonlyMap<string, string>;
  (
    state: encodeTypes.SidecarState,
    writes: readonly typesModule.StorageWrite[],
    encoded: formatTypes.EncodedCommit,
  ): ReadonlyMap<string, string>;
} = Function.dual(
  3,
  (
    state: encodeTypes.SidecarState,
    writes: readonly typesModule.StorageWrite[],
    encoded: formatTypes.EncodedCommit,
  ): ReadonlyMap<string, string> => {
    const shape = commitShape(writes);
    const replacements = new Map<string, string>();
    const isCurrentOnlyDocument = (id: typesModule.DocumentId): boolean =>
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

const adoptSidecarState: {
  (writes: readonly typesModule.StorageWrite[]): (state: encodeTypes.MutableSidecarState) => void;
  (state: encodeTypes.MutableSidecarState, writes: readonly typesModule.StorageWrite[]): void;
} = Function.dual(
  2,
  (state: encodeTypes.MutableSidecarState, writes: readonly typesModule.StorageWrite[]): void => {
    for (const write of writes) {
      if (write.type === "document.create") {
        if (isCurrentOnly(write.record)) state.currentOnlyDocuments.add(write.record.id);
      } else if (write.type === "task") {
        if (write.value.state.status === "terminal") state.liveTaskSidecars.delete(write.value.id);
        else state.liveTaskSidecars.add(write.value.id);
      }
    }
  },
);

const encode = {
  adoptSidecarState,
  encodeCommit,
  planReclamations,
};

export default encode;
