import type chordTypes from "@msa/chord/index.types";

import type typesModule from "../types.types.ts";
import type storageBenchmark from "./storage-benchmark.ts";

declare namespace storageBenchmarkTypes {
  type StorageBenchmarkScale = {
    readonly name: string;
    readonly entryCount: number;
    readonly taskCount: number;
    readonly documentCount: number;
  };

  type StoredTask = typesModule.TaskRecord<
    chordTypes.JsonValue,
    chordTypes.JsonValue,
    chordTypes.JsonValue
  >;

  type StorageBenchmarkDataset = {
    readonly firstEntryId: typesModule.EntryId;
    readonly filteredTaskCount: number;
    readonly exactDocumentId: typesModule.DocumentId;
    readonly exactDocumentKey: string;
    readonly replayDocumentIds: Readonly<
      Record<(typeof storageBenchmark.REPLAY_TAILS)[number], typesModule.DocumentId>
    >;
    readonly historicalDocumentId: typesModule.DocumentId;
    readonly ancientAt: typesModule.Seq;
    readonly recentAt: typesModule.Seq;
    readonly deepestConversationId: typesModule.ConversationId;
    readonly ancestorHeadEntryId: typesModule.EntryId;
  };
}

export type { storageBenchmarkTypes as default };
