import type chordTypes from "@msa/chord/index.types";

import type typesModule from "../../types.types.ts";

declare namespace codecTypes {
  type StoredTask = typesModule.TaskRecord<
    chordTypes.JsonValue,
    chordTypes.JsonValue,
    chordTypes.JsonValue
  >;

  type TableName = "conversation" | "entry" | "task" | "submission" | "document";

  type RecordIdRow = { readonly record_type: TableName };

  type JsonRow = { readonly record: string };

  type EntryJsonRow = { readonly record: string; readonly commit_seq: number };

  type RevisionRow = {
    readonly seq: number;
    readonly kind: typesModule.DocumentContent["kind"];
    readonly version: number;
    readonly content: string;
  };

  type ForkSegment = {
    readonly conversationId: typesModule.ConversationId;
    readonly upper: number | undefined;
  };

  type IdRow = { readonly id: number };

  type MetadataRow = { readonly next_id: string; readonly next_seq: number };

  type DocumentAction = {
    create?: typesModule.DocumentCreate;
    copy?: Extract<typesModule.StorageWrite, { readonly type: "document.copy" }>["source"];
    content?: typesModule.DocumentContent;
    retire: boolean;
  };
}

export type { codecTypes as default };
