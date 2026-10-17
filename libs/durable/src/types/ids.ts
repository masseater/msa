import type { JsonValue } from "@msa/chord";

export type JsonObject = { [key: string]: JsonValue };

declare const idBrand: unique symbol;

export type Id<Kind extends string, Type = unknown> = number & {
  readonly [idBrand]: {
    readonly kind: Kind;
    readonly type: Type;
  };
};

export type ConversationId = Id<"conversation">;
export type EntryId = Id<"entry">;
export type TaskId<Result = unknown> = Id<"task", Result>;
export type SubmissionId = Id<"submission">;
export type DocumentId = Id<"document">;

declare const seqBrand: unique symbol;

export type Seq = number & { readonly [seqBrand]: "sequence" };

export const ROOT_CONVERSATION_ID = 1 as ConversationId;
