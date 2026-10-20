import type { Message } from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";

import type idsTypes from "./ids.types.ts";

declare namespace recordsTypes {
  type ConversationOwnership =
    | { readonly kind: "ownerless" }
    | { readonly kind: "task"; readonly taskId: idsTypes.TaskId };

  type ConversationRecord = {
    readonly id: idsTypes.ConversationId;
    readonly parent?: {
      readonly conversationId: idsTypes.ConversationId;
      readonly at: idsTypes.EntryId;
    };
    readonly owner?: {
      readonly conversationId: idsTypes.ConversationId;
      readonly taskId: idsTypes.TaskId;
    };
  };

  type ContextEdit = {
    readonly target: idsTypes.EntryId;
  } & (
    | {
        readonly action: "omit";
        readonly messages?: never;
      }
    | {
        readonly action: "replace";
        readonly messages: readonly Message[];
      }
  );

  type EntryRecord = {
    readonly id: idsTypes.EntryId;
    readonly conversationId: idsTypes.ConversationId;
    readonly kind: string;
    readonly model?: readonly Message[];
    readonly data?: chordTypes.JsonValue;
    readonly head?: idsTypes.EntryId;
    readonly edits?: readonly ContextEdit[];
    readonly byTaskId?: idsTypes.TaskId;
  };

  type EntryDraft = Omit<EntryRecord, "id" | "conversationId" | "byTaskId" | "head" | "data"> & {
    readonly data?: chordTypes.JsonValue | undefined;
    readonly head?: idsTypes.EntryId | "self";
  };

  type TypedEntry<D extends chordTypes.JsonValue> = Omit<EntryRecord, "data"> &
    ([D] extends [never] ? { readonly data?: never } : { readonly data: D });

  type TypedEntryDraft<D extends chordTypes.JsonValue> = Omit<EntryDraft, "kind" | "data"> &
    ([D] extends [never] ? { readonly data?: never } : { readonly data: D });

  interface Entry<D extends chordTypes.JsonValue = never> {
    readonly kind: string;
    is(entry: EntryRecord | undefined): entry is TypedEntry<D>;
  }

  type SubmissionRecordBase = {
    readonly id: idsTypes.SubmissionId;
    readonly conversationId: idsTypes.ConversationId;
    readonly requestId?: string;
  };

  type SubmissionRecord =
    | (SubmissionRecordBase & {
        readonly type: "input";
      } & (
          | {
              readonly status: "queued";
              readonly entry?: never;
              readonly answer?: never;
              readonly reason?: never;
              readonly detail?: never;
            }
          | {
              readonly status: "placed";
              readonly entry: idsTypes.EntryId;
              readonly answer?: never;
              readonly reason?: never;
              readonly detail?: never;
            }
          | {
              readonly status: "done";
              readonly entry: idsTypes.EntryId;
              readonly answer: idsTypes.EntryId;
              readonly reason?: never;
              readonly detail?: never;
            }
          | {
              readonly status: "unanswered";
              readonly entry?: idsTypes.EntryId;
              readonly answer?: never;
              readonly reason: string;
              readonly detail?: chordTypes.JsonValue;
            }
        ))
    | (SubmissionRecordBase & {
        readonly type: "write";
      } & (
          | {
              readonly status: "queued";
              readonly entry?: never;
              readonly answer?: never;
              readonly reason?: never;
              readonly detail?: never;
            }
          | {
              readonly status: "done";
              readonly entry: idsTypes.EntryId;
              readonly answer?: never;
              readonly reason?: never;
              readonly detail?: never;
            }
          | {
              readonly status: "unanswered";
              readonly entry?: never;
              readonly answer?: never;
              readonly reason: string;
              readonly detail?: chordTypes.JsonValue;
            }
        ));

  type SubmissionSettlement =
    | { readonly status: "done"; readonly answer: idsTypes.EntryId }
    | {
        readonly status: "unanswered";
        readonly reason: string;
        readonly detail?: chordTypes.JsonValue;
      };

  type SubmissionCreate = SubmissionRecord extends infer Record
    ? Record extends SubmissionRecord
      ? Omit<Record, "id">
      : never
    : never;
}

export type { recordsTypes as default };
