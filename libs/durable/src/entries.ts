import type { JsonValue } from "@msa/chord";

import type typesModuleModule from "./harness/types.types.ts";
import type typesModule from "./types.types.ts";

function defineEntry<D extends JsonValue = never>(kind: string): typesModule.Entry<D> {
  if (typeof kind !== "string" || kind.length === 0)
    throw new TypeError("Entry kind must be a non-empty string");
  return {
    is: (entry: typesModule.EntryRecord | undefined): entry is typesModule.TypedEntry<D> =>
      entry !== undefined && entry.kind === kind,
    kind,
  };
}

const UserEntry = defineEntry("msa.user");
const AssistantEntry = defineEntry("msa.assistant");
const SystemEntry = defineEntry("msa.system");
const ToolResultEntry = defineEntry<{ diagnostics: typesModuleModule.ToolDiagnostic[] }>(
  "msa.tool-result",
);
const ResetEntry = defineEntry("msa.reset");
const CompactionEntry = defineEntry<{ reason: typesModuleModule.CompactionReason }>(
  "msa.compaction",
);

const entries = {
  AssistantEntry,
  CompactionEntry,
  ResetEntry,
  SystemEntry,
  ToolResultEntry,
  UserEntry,
  defineEntry,
};

export default entries;
