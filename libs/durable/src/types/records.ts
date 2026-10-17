import type { Message } from "@msa/ai";
import type { JsonValue } from "@msa/chord";

import type { ConversationId, EntryId, SubmissionId, TaskId } from "./ids.ts";

export type ConversationOwnership =
  | { readonly kind: "ownerless" }
  | { readonly kind: "task"; readonly taskId: TaskId };

export type ConversationRecord = {
  readonly id: ConversationId;
  readonly parent?: {
    readonly conversationId: ConversationId;
    readonly at: EntryId;
  };
  readonly owner?: {
    readonly conversationId: ConversationId;
    readonly taskId: TaskId;
  };
};

export type ContextEdit = {
  readonly target: EntryId;
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

export type EntryRecord = {
  readonly id: EntryId;
  readonly conversationId: ConversationId;
  readonly kind: string;
  readonly model?: readonly Message[];
  readonly data?: JsonValue;
  readonly head?: EntryId;
  readonly edits?: readonly ContextEdit[];
  readonly byTaskId?: TaskId;
};

export type EntryDraft = Omit<
  EntryRecord,
  "id" | "conversationId" | "byTaskId" | "head" | "data"
> & {
  readonly data?: JsonValue | undefined;
  readonly head?: EntryId | "self";
};

export type TypedEntry<D extends JsonValue> = Omit<EntryRecord, "data"> &
  ([D] extends [never] ? { readonly data?: never } : { readonly data: D });

export type TypedEntryDraft<D extends JsonValue> = Omit<EntryDraft, "kind" | "data"> &
  ([D] extends [never] ? { readonly data?: never } : { readonly data: D });

export interface Entry<D extends JsonValue = never> {
  readonly kind: string;
  is(entry: EntryRecord | undefined): entry is TypedEntry<D>;
}

type SubmissionRecordBase = {
  readonly id: SubmissionId;
  readonly conversationId: ConversationId;
  readonly requestId?: string;
};

export type SubmissionRecord =
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
            readonly entry: EntryId;
            readonly answer?: never;
            readonly reason?: never;
            readonly detail?: never;
          }
        | {
            readonly status: "done";
            readonly entry: EntryId;
            readonly answer: EntryId;
            readonly reason?: never;
            readonly detail?: never;
          }
        | {
            readonly status: "unanswered";
            readonly entry?: EntryId;
            readonly answer?: never;
            readonly reason: string;
            readonly detail?: JsonValue;
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
            readonly entry: EntryId;
            readonly answer?: never;
            readonly reason?: never;
            readonly detail?: never;
          }
        | {
            readonly status: "unanswered";
            readonly entry?: never;
            readonly answer?: never;
            readonly reason: string;
            readonly detail?: JsonValue;
          }
      ));

export type SubmissionSettlement =
  | { readonly status: "done"; readonly answer: EntryId }
  | { readonly status: "unanswered"; readonly reason: string; readonly detail?: JsonValue };

export type SubmissionCreate = SubmissionRecord extends infer Record
  ? Record extends SubmissionRecord
    ? Omit<Record, "id">
    : never
  : never;
