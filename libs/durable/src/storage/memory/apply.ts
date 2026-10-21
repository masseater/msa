import { Function } from "effect";

import type typesModule from "../../types.types.ts";
import stateModule from "./state.ts";
import type stateTypes from "./state.types.ts";

const { insertMapId, insertSorted, isCurrentOnly, recordAddressKey, removeSorted, scopeKey } =
  stateModule;

type TableWrite<T extends typesModule.StorageWrite["type"]> = Extract<
  typesModule.StorageWrite,
  { type: T }
>;

const applyConversation = (state: stateTypes.State, write: TableWrite<"conversation">): void => {
  state.recordTypes.set(write.value.id, "conversation");
  state.conversations.set(write.value.id, write.value);
  insertSorted(state.conversationIds, write.value.id);
  const owner = write.value.owner;
  if (owner !== undefined) {
    insertMapId(state.conversationIdsByOwnerConversation, owner.conversationId, write.value.id);
    insertMapId(state.conversationIdsByOwnerTask, owner.taskId, write.value.id);
  }
};

const applyEntry = (
  state: stateTypes.State,
  write: TableWrite<"entry">,
  seq: typesModule.Seq,
): void => {
  state.recordTypes.set(write.value.id, "entry");
  state.entries.set(write.value.id, write.value);
  state.entryCommitSeqs.set(write.value.id, seq);
  insertMapId(state.entryIds, write.value.conversationId, write.value.id);
  if (write.value.head !== undefined) {
    insertMapId(state.headEntryIds, write.value.conversationId, write.value.id);
  }
};

const applyTask = (state: stateTypes.State, write: TableWrite<"task">): void => {
  state.recordTypes.set(write.value.id, "task");
  const previous = state.tasks.get(write.value.id);
  if (previous === undefined) {
    insertSorted(state.taskIds, write.value.id);
    insertSorted(state.taskIdsByStatus[write.value.state.status], write.value.id);
  } else if (previous.state.status !== write.value.state.status) {
    removeSorted(state.taskIdsByStatus[previous.state.status], write.value.id);
    insertSorted(state.taskIdsByStatus[write.value.state.status], write.value.id);
  }
  state.tasks.set(write.value.id, write.value);
};

const forgetRequest = (state: stateTypes.State, write: TableWrite<"submission">): void => {
  const previous = state.submissions.get(write.value.id);
  if (previous?.requestId === undefined) return;
  const previousRequests = state.submissionIdsByRequest.get(previous.conversationId);
  if (previousRequests?.get(previous.requestId) !== write.value.id) return;
  previousRequests.delete(previous.requestId);
  if (previousRequests.size === 0) state.submissionIdsByRequest.delete(previous.conversationId);
};

const rememberRequest = (state: stateTypes.State, write: TableWrite<"submission">): void => {
  if (write.value.requestId === undefined) return;
  let requests = state.submissionIdsByRequest.get(write.value.conversationId);
  if (requests === undefined) {
    requests = new Map();
    state.submissionIdsByRequest.set(write.value.conversationId, requests);
  }
  requests.set(write.value.requestId, write.value.id);
};

const applySubmission = (state: stateTypes.State, write: TableWrite<"submission">): void => {
  state.recordTypes.set(write.value.id, "submission");
  const previous = state.submissions.get(write.value.id);
  if (previous === undefined) {
    insertSorted(state.submissionIds, write.value.id);
    insertSorted(state.submissionIdsByStatus[write.value.status], write.value.id);
  } else if (previous.status !== write.value.status) {
    removeSorted(state.submissionIdsByStatus[previous.status], write.value.id);
    insertSorted(state.submissionIdsByStatus[write.value.status], write.value.id);
  }
  forgetRequest(state, write);
  state.submissions.set(write.value.id, write.value);
  rememberRequest(state, write);
};

const applyTableWrite: {
  (
    write: typesModule.StorageWrite,
    seq: typesModule.Seq,
  ): (state: stateTypes.State) => number | undefined;
  (
    state: stateTypes.State,
    write: typesModule.StorageWrite,
    seq: typesModule.Seq,
  ): number | undefined;
} = Function.dual(
  3,
  (
    state: stateTypes.State,
    write: typesModule.StorageWrite,
    seq: typesModule.Seq,
  ): number | undefined => {
    switch (write.type) {
      case "conversation":
        applyConversation(state, write);
        return write.value.id;
      case "entry":
        applyEntry(state, write, seq);
        return write.value.id;
      case "task":
        applyTask(state, write);
        return write.value.id;
      case "submission":
        applySubmission(state, write);
        return write.value.id;
      case "document.copy":
        throw new Error("Prepared document copy was not resolved");
      case "document.create":
      case "document.change":
      case "document.retire":
        return undefined;
    }
  },
);

const createDocument = (
  state: stateTypes.State,
  id: typesModule.DocumentId,
  action: stateTypes.DocumentAction & {
    readonly create: NonNullable<stateTypes.DocumentAction["create"]>;
  },
  seq: typesModule.Seq,
): stateTypes.StoredDocumentState => {
  const record = {
    ...action.create,
    createdAt: seq,
    ...(action.retire ? { retiredAt: seq } : {}),
  };
  const stored: stateTypes.StoredDocumentState = {
    record,
    revisions: [{ ...action.content!, seq }],
  };
  state.recordTypes.set(id, "document");
  state.documents.set(id, stored);
  const key = recordAddressKey(record);
  let address = state.documentAddresses.get(key);
  if (address === undefined) {
    address = { ids: [] };
    state.documentAddresses.set(key, address);
  }
  insertSorted(address.ids, id);
  insertMapId(state.documentIdsByScope, scopeKey(record.scope), id);
  return stored;
};

const changeDocument = (
  stored: stateTypes.StoredDocumentState,
  action: stateTypes.DocumentAction,
  seq: typesModule.Seq,
): void => {
  if (action.content === undefined) return;
  const revision = { ...action.content, seq };
  if (revision.kind === "base" && isCurrentOnly(stored.record)) stored.revisions = [revision];
  else stored.revisions.push(revision);
};

const applyDocumentAction = (
  state: stateTypes.State,
  id: typesModule.DocumentId,
  action: stateTypes.DocumentAction,
  seq: typesModule.Seq,
): void => {
  const create = action.create;
  const stored =
    create === undefined
      ? state.documents.get(id)!
      : createDocument(state, id, { ...action, create }, seq);
  if (create === undefined) changeDocument(stored, action, seq);
  if (action.retire && create === undefined) stored.record = { ...stored.record, retiredAt: seq };
  if (action.retire && isCurrentOnly(stored.record)) stored.revisions = [];
  if (create === undefined && !action.retire) return;
  const address = state.documentAddresses.get(recordAddressKey(stored.record))!;
  if (action.retire && address.currentId === id) delete address.currentId;
  if (create !== undefined && !action.retire) address.currentId = id;
};

const applyDocumentActions: {
  (
    actions: ReadonlyMap<typesModule.DocumentId, stateTypes.DocumentAction>,
    seq: typesModule.Seq,
  ): (state: stateTypes.State) => number;
  (
    state: stateTypes.State,
    actions: ReadonlyMap<typesModule.DocumentId, stateTypes.DocumentAction>,
    seq: typesModule.Seq,
  ): number;
} = Function.dual(
  3,
  (
    state: stateTypes.State,
    actions: ReadonlyMap<typesModule.DocumentId, stateTypes.DocumentAction>,
    seq: typesModule.Seq,
  ): number => {
    let maxCreated = 0;
    for (const [id, action] of actions) {
      applyDocumentAction(state, id, action, seq);
      if (action.create !== undefined) maxCreated = Math.max(maxCreated, id);
    }
    return maxCreated;
  },
);

const apply = {
  applyDocumentActions,
  applyTableWrite,
};

export default apply;
