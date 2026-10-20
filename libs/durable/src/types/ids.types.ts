import type chordTypes from "@msa/chord/index.types";

declare const idBrand: unique symbol;

declare const seqBrand: unique symbol;

declare namespace idsTypes {
  type JsonObject = { [key: string]: chordTypes.JsonValue };

  type Id<Kind extends string, Type = unknown> = number & {
    readonly [idBrand]: {
      readonly kind: Kind;
      readonly type: Type;
    };
  };

  type ConversationId = Id<"conversation">;

  type EntryId = Id<"entry">;

  type TaskId<Result = unknown> = Id<"task", Result>;

  type SubmissionId = Id<"submission">;

  type DocumentId = Id<"document">;

  type Seq = number & { readonly [seqBrand]: "sequence" };
}

export type { idsTypes as default };
