import applyModule from "@msa/chord/delta/apply";
import { Function } from "effect";

import errors from "../../errors.ts";
import type typesModule from "../../types.types.ts";
import stateModule from "./state.ts";
import type stateTypes from "./state.types.ts";

const { applyImmutableBatches } = applyModule;

const { documentDeltaBatches, isAliveAt, isCurrentOnly, recordAddressKey } = stateModule;
const { StorageRequestError } = errors;

const materializeDocument: {
  (
    id: typesModule.DocumentId,
    at: typesModule.DocumentPoint,
  ): (state: stateTypes.State) => typesModule.StoredDocument | undefined;
  (
    state: stateTypes.State,
    id: typesModule.DocumentId,
    at: typesModule.DocumentPoint,
  ): typesModule.StoredDocument | undefined;
} = Function.dual(
  3,
  (
    state: stateTypes.State,
    id: typesModule.DocumentId,
    at: typesModule.DocumentPoint,
  ): typesModule.StoredDocument | undefined => {
    const stored = state.documents.get(id);
    if (stored === undefined) return undefined;
    if (at !== "current" && isCurrentOnly(stored.record)) {
      throw StorageRequestError.create(`Document ${id} does not retain historical content`);
    }
    if (!isAliveAt(stored.record, at)) return undefined;
    const revisions =
      at === "current"
        ? stored.revisions
        : stored.revisions.filter((revision) => revision.seq <= at);
    let baseIndex = revisions.length - 1;
    while (baseIndex >= 0 && revisions[baseIndex]!.kind !== "base") baseIndex--;
    const base = revisions[baseIndex];
    if (base?.kind !== "base") throw new Error(`Document ${id} is missing a required base`);
    const value = applyImmutableBatches(
      base.value,
      documentDeltaBatches(id, base.version, revisions, baseIndex + 1),
    ) as typesModule.JsonObject;
    return {
      deltasSinceBase: revisions.length - baseIndex - 1,
      record: stored.record,
      value,
      version: base.version,
    };
  },
);

const changedDocumentIds = (
  writes: readonly typesModule.StorageWrite[],
): ReadonlySet<typesModule.DocumentId> => {
  const changed = new Set<typesModule.DocumentId>();
  for (const write of writes) {
    if (write.type === "document.create" || write.type === "document.copy") {
      changed.add(write.record.id);
    } else if (write.type === "document.change" || write.type === "document.retire") {
      changed.add(write.id);
    }
  }
  return changed;
};

type CopyWrite = Extract<typesModule.StorageWrite, { type: "document.copy" }>;

const resolveCopy = (
  state: stateTypes.State,
  write: CopyWrite,
  changed: ReadonlySet<typesModule.DocumentId>,
): typesModule.StorageWrite => {
  if (changed.has(write.source.id)) {
    throw new Error(`Fork source document ${write.source.id} is changed in the copy batch`);
  }
  const stored = materializeDocument(state, write.source.id, write.source.at);
  if (stored === undefined)
    throw new Error(`Fork source document ${write.source.id} cannot be read`);
  if (
    stored.record.scope.kind !== "conversation" ||
    write.record.scope.kind !== "conversation" ||
    stored.record.kind !== write.record.kind ||
    stored.record.key !== write.record.key ||
    stored.record.history !== write.record.history ||
    stored.record.fork !== write.record.fork
  ) {
    throw new Error(`Fork source document ${write.source.id} does not match the copied record`);
  }
  return {
    content: { kind: "base", value: stored.value, version: stored.version },
    record: write.record,
    type: "document.create",
  };
};

const resolveDocumentCopies: {
  (writes: typesModule.StorageWrite[]): (state: stateTypes.State) => typesModule.StorageWrite[];
  (state: stateTypes.State, writes: typesModule.StorageWrite[]): typesModule.StorageWrite[];
} = Function.dual(
  2,
  (state: stateTypes.State, writes: typesModule.StorageWrite[]): typesModule.StorageWrite[] => {
    if (!writes.some((write) => write.type === "document.copy")) return writes;
    const changed = changedDocumentIds(writes);
    return writes.map((write) => {
      if (write.type !== "document.copy") return write;
      try {
        return resolveCopy(state, write, changed);
      } catch (error) {
        throw new Error(`Document copy ${write.record.id} was rejected`, { cause: error });
      }
    });
  },
);

const checkClaim = (
  id: typesModule.Id<string>,
  table: stateTypes.TableName,
  existing: stateTypes.TableName | undefined,
  earlier: stateTypes.TableName | undefined,
): void => {
  if (table === "conversation" || table === "entry" || table === "document") {
    if (existing !== undefined) throw new Error(`ID ${id} already belongs to ${existing}`);
    if (earlier !== undefined) throw new Error(`ID ${id} is written more than once`);
    return;
  }
  if (existing !== undefined && existing !== table) {
    throw new Error(`ID ${id} already belongs to ${existing}`);
  }
  if (earlier !== undefined && earlier !== table)
    throw new Error(`ID ${id} is written as two record types`);
};

const checkGlobalIds: {
  (writes: readonly typesModule.StorageWrite[]): (state: stateTypes.State) => void;
  (state: stateTypes.State, writes: readonly typesModule.StorageWrite[]): void;
} = Function.dual(
  2,
  (state: stateTypes.State, writes: readonly typesModule.StorageWrite[]): void => {
    const claimed = new Map<typesModule.Id<string>, stateTypes.TableName>();
    for (const write of writes) {
      if (write.type === "document.change" || write.type === "document.retire") continue;
      const document = write.type === "document.create" || write.type === "document.copy";
      const table: stateTypes.TableName = document ? "document" : write.type;
      const id = document ? write.record.id : write.value.id;
      checkClaim(id, table, state.recordTypes.get(id), claimed.get(id));
      claimed.set(id, table);
    }
  },
);

type DocumentWrite = Extract<
  typesModule.StorageWrite,
  { type: "document.create" | "document.change" | "document.retire" }
>;

const isDocumentWrite = (write: typesModule.StorageWrite): write is DocumentWrite =>
  write.type === "document.create" ||
  write.type === "document.change" ||
  write.type === "document.retire";

const addDocumentWrite = (
  action: stateTypes.DocumentAction,
  write: DocumentWrite,
  id: typesModule.DocumentId,
): void => {
  switch (write.type) {
    case "document.create":
      if (action.create !== undefined || action.content !== undefined) {
        throw new Error(`Document ${id} has more than one content command`);
      }
      action.create = write.record;
      action.content = write.content;
      break;
    case "document.change":
      if (action.content !== undefined)
        throw new Error(`Document ${id} has more than one content command`);
      action.content = write.content;
      break;
    case "document.retire":
      if (action.retire) throw new Error(`Document ${id} is retired more than once`);
      action.retire = true;
      break;
  }
};

const prepareDocumentActions = (
  writes: readonly typesModule.StorageWrite[],
): Map<typesModule.DocumentId, stateTypes.DocumentAction> => {
  const actions = new Map<typesModule.DocumentId, stateTypes.DocumentAction>();
  for (const write of writes) {
    if (!isDocumentWrite(write)) continue;
    const id = write.type === "document.create" ? write.record.id : write.id;
    let action = actions.get(id);
    if (action === undefined) {
      action = { retire: false };
      actions.set(id, action);
    }
    addDocumentWrite(action, write, id);
  }
  return actions;
};

const checkDocumentAction = (
  state: stateTypes.State,
  id: typesModule.DocumentId,
  action: stateTypes.DocumentAction,
): string => {
  const existing = state.documents.get(id);
  if (action.create === undefined && existing === undefined)
    throw new Error(`Unknown document: ${id}`);
  if (action.create !== undefined && existing !== undefined)
    throw new Error(`Document ${id} already exists`);
  if (existing?.record.retiredAt !== undefined) throw new Error(`Document ${id} is retired`);
  const previous = existing?.revisions.at(-1);
  if (action.content?.kind === "delta") {
    if (previous === undefined) throw new Error(`Document ${id} delta has no base`);
    if (previous.version !== action.content.version) {
      throw new Error(`Document ${id} version transition requires a base`);
    }
  }
  return action.create === undefined
    ? recordAddressKey(existing!.record)
    : recordAddressKey(action.create);
};

const checkDocumentActions: {
  (
    actions: ReadonlyMap<typesModule.DocumentId, stateTypes.DocumentAction>,
  ): (state: stateTypes.State) => void;
  (
    state: stateTypes.State,
    actions: ReadonlyMap<typesModule.DocumentId, stateTypes.DocumentAction>,
  ): void;
} = Function.dual(
  2,
  (
    state: stateTypes.State,
    actions: ReadonlyMap<typesModule.DocumentId, stateTypes.DocumentAction>,
  ): void => {
    const liveCounts = new Map<string, number>();
    for (const [id, action] of actions) {
      const key = checkDocumentAction(state, id, action);
      const currentId = state.documentAddresses.get(key)?.currentId;
      let live = liveCounts.get(key) ?? (currentId === undefined ? 0 : 1);
      if (action.retire && currentId === id) live--;
      if (action.create !== undefined && !action.retire) live++;
      liveCounts.set(key, live);
    }
    for (const live of liveCounts.values()) {
      if (live > 1) throw new Error(`Document address already has a current incarnation`);
    }
  },
);

const documentsModule = {
  checkDocumentActions,
  checkGlobalIds,
  materializeDocument,
  prepareDocumentActions,
  resolveDocumentCopies,
};

export default documentsModule;
