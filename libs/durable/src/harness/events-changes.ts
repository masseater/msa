import type deltaTypes from "@msa/chord/delta.types";
import { Function } from "effect";

import type eventsChangesTypes from "./events-changes.types.ts";
import toolTypes from "./tool-types.ts";
import type toolTypesModule from "./tool-types.types.ts";
import type typesModule from "./types.types.ts";

const { NestedCallDoc } = toolTypes;

const nestedResult = (
  change: typesModule.CommitChange,
  changes: eventsChangesTypes.Changes,
): void => {
  if (change.type !== "document" || change.value === null) return;
  if (change.record.kind !== NestedCallDoc.definition.kind) return;
  const state = change.value as toolTypesModule.NestedCallState;
  if (state.taskId === undefined || state.result === undefined) return;
  changes.nestedResults.set(
    state.taskId,
    state.result as unknown as typesModule.NestedToolExecutionResult,
  );
};

const collect: typesModule.Dual2<
  typesModule.CommitPublication,
  typesModule.ConversationId,
  eventsChangesTypes.Changes
> = Function.dual(
  2,
  (
    publication: typesModule.CommitPublication,
    conversationId: typesModule.ConversationId,
  ): eventsChangesTypes.Changes => {
    const changes: eventsChangesTypes.Changes = {
      entries: [],
      nestedResults: new Map(),
      submissions: [],
      tasks: new Map(),
    };
    for (const change of publication.changes) {
      if (change.type === "document" && change.conversationId === conversationId)
        nestedResult(change, changes);
      if (change.type === "entry" && change.value.conversationId === conversationId)
        changes.entries.push(change.value);
      if (change.type === "task" && change.value.conversationId === conversationId)
        changes.tasks.set(change.value.id, change.value);
      if (change.type === "submission" && change.value.conversationId === conversationId)
        changes.submissions.push(change.value);
    }
    changes.submissions.sort((a, b) => a.id - b.id);
    return changes;
  },
);

const quiet: typesModule.Dual2<readonly deltaTypes.Op[], eventsChangesTypes.Changes, boolean> =
  Function.dual(
    2,
    (viewOps: readonly deltaTypes.Op[], changes: eventsChangesTypes.Changes): boolean =>
      viewOps.length === 0 &&
      changes.entries.length === 0 &&
      changes.tasks.size === 0 &&
      changes.submissions.length === 0,
  );

const eventsChanges = {
  collect,
  quiet,
};

export default eventsChanges;
